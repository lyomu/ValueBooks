// FIRST DRAFT -- not yet run against a real build. Modeled on drift's working
// Jenkinsfile (same DooD controller, same build-lock + per-build image
// cleanup pattern) but adapted: Docker Hub instead of GHCR (dockerhub-credentials,
// folder-scoped at einsbrand/), and one shared CI image covers lint/typecheck/test
// for the whole npm-workspaces monorepo rather than per-app parallel stages,
// since `npm run lint`/`typecheck`/`test` already iterate every workspace from
// the root.
//
// Single environment (prod only) -- ValueBooks has no dev/staging box, deployed
// to its own dedicated box (161.97.140.207), not the shared one. See
// devops-infra/docs/VALUEBOOKS_DEDICATED_BOX_PROVISIONING.md.
//
// VALUEBOOKS_PROD_HOST must be set as a global Jenkins env var (Manage Jenkins
// -> System), not hardcoded here -- harusi-ke's Deploy Prod stage was hardcoded
// to a stale IP for months before anyone noticed (see devops-infra/docs/DEVOPS.md
// §5). Set it to 161.97.140.207 before the first real run.
//
// Verify this against a REAL build's console log before trusting any green
// checkmark -- especially the Playwright/canvas steps in apps/api/Dockerfile,
// which are exactly the kind of thing that can report SUCCESS while silently
// not doing what's intended.

pipeline {
    agent any

    options {
        disableConcurrentBuilds()
    }

    environment {
        WEB_IMAGE_NAME = 'lyomu/valuebooks-web'
        API_IMAGE_NAME = 'lyomu/valuebooks-api'
        NEXT_PUBLIC_API_URL = 'https://api.valuebooks.co'
    }

    stages {
        stage('Checkout') {
            steps {
                echo "Building branch: ${env.BRANCH_NAME}, commit: ${env.GIT_COMMIT}"
                sh """
                    LOCKDIR=/var/jenkins_home/valuebooks-build.lock
                    STALE_AFTER=2400
                    while ! mkdir "\$LOCKDIR" 2>/dev/null; do
                        age=\$(( \$(date +%s) - \$(stat -c %Y "\$LOCKDIR" 2>/dev/null || date +%s) ))
                        if [ "\$age" -ge "\$STALE_AFTER" ]; then
                            echo "Lock held for \${age}s (>= \${STALE_AFTER}s) - assuming its holder crashed, taking over."
                            rmdir "\$LOCKDIR" 2>/dev/null || true
                            continue
                        fi
                        echo "Waiting for another ValueBooks build to finish (valuebooks-build.lock held for \${age}s)..."
                        sleep 15
                    done
                    echo "Acquired valuebooks-build.lock."
                """
                script { env.LOCK_ACQUIRED = 'true' }
                sh """
                    docker container prune -f || true
                    docker image prune -af || true
                    docker builder prune -af || true
                """
                script {
                    env.IMAGE_TAG = "sha-${env.GIT_COMMIT.take(12)}"
                    env.SAFE_BRANCH_NAME = env.BRANCH_NAME.replaceAll('[^a-zA-Z0-9_.-]', '-')
                }
            }
        }

        stage('Build CI images') {
            // --target build on each Dockerfile also validates that app's own
            // production build (next build / nest build) actually compiles --
            // not just that lint/typecheck pass against source.
            steps {
                script {
                    env.WEB_CI_IMAGE = "valuebooks-web-ci:${env.SAFE_BRANCH_NAME}-${env.BUILD_NUMBER}"
                    env.API_CI_IMAGE = "valuebooks-api-ci:${env.SAFE_BRANCH_NAME}-${env.BUILD_NUMBER}"
                    docker.build(
                        env.WEB_CI_IMAGE,
                        "--target build --build-arg NEXT_PUBLIC_API_URL=${env.NEXT_PUBLIC_API_URL} -f apps/web/Dockerfile ."
                    )
                    docker.build(env.API_CI_IMAGE, '--target build -f apps/api/Dockerfile .')
                }
            }
        }

        stage('Lint') {
            // Three sequential eslint passes instead of one root-level
            // `eslint .`. The root config is recommendedTypeChecked +
            // projectService, so a single pass builds one TS program for the
            // whole monorepo and peaks at ~3.1 GiB RSS -- more than this box
            // can spare (docs/CI_BOX_CAPACITY.md: ~4.0 GiB free of 7.6 GiB,
            // and its 2 GiB swap is already full at idle). That OOM'd V8 at
            // its ~2 GiB default heap ceiling on build #6.
            //
            // Measured peaks per pass: apps/api 1.9 GiB, apps/web 1.5 GiB,
            // everything else 0.8 GiB -- so splitting caps exposure at
            // ~1.9 GiB and is slightly faster overall (78s vs 100s).
            //
            // The last pass is a negative match, not an explicit list, so a
            // new top-level directory can never silently escape linting --
            // the union of the three passes is exactly `eslint .`.
            //
            // --memory is a hard kernel ceiling (container dies with 137 if
            // hit) so a runaway lint can't take the shared CI box down with
            // it; max-old-space-size keeps V8 bounded below that ceiling
            // instead of letting it discover the limit by being killed.
            steps {
                script {
                    [
                        'apps/api',
                        'apps/web',
                        '. --ignore-pattern "apps/api/**" --ignore-pattern "apps/web/**"',
                    ].each { target ->
                        sh "docker run --rm --memory=3072m -e NODE_OPTIONS=--max-old-space-size=2560 ${env.API_CI_IMAGE} npx eslint ${target} --max-warnings=0"
                    }
                }
            }
        }

        stage('Typecheck') {
            steps {
                sh "docker run --rm ${env.API_CI_IMAGE} npm run typecheck"
            }
        }

        stage('Test') {
            // DB-free unit suite across every workspace (README: "npm test is
            // the fast, DB-free suite and needs no running infrastructure").
            steps {
                sh "docker run --rm ${env.API_CI_IMAGE} npm test"
            }
        }

        stage('Test (integration)') {
            // Needs three real backing services, not just Postgres. The suite talks to a live
            // Redis (BullMQ email/automation queues) and a live S3 -- attachments.int.test.ts
            // deliberately asserts StorageService wrote real bytes rather than mocking it.
            // Build #8 started only Postgres, so every queue-backed spec hit ECONNREFUSED on
            // localhost:56780 (the NODE_ENV=test default in packages/config/src/index.ts) and
            // the storage specs would have failed right behind them.
            //
            // MinIO here is a CI stand-in for object storage ONLY. Production points S3_* at
            // managed storage and docker-compose.prod.yml deliberately has no minio service --
            // see devops-infra/docs/VALUEBOOKS_DEDICATED_BOX_PROVISIONING.md for why.
            steps {
                script {
                    env.CI_NET = "valuebooks-ci-net-${env.SAFE_BRANCH_NAME}-${env.BUILD_NUMBER}"
                    env.CI_PG = "valuebooks-ci-postgres-${env.SAFE_BRANCH_NAME}-${env.BUILD_NUMBER}"
                    env.CI_REDIS = "valuebooks-ci-redis-${env.SAFE_BRANCH_NAME}-${env.BUILD_NUMBER}"
                    env.CI_MINIO = "valuebooks-ci-minio-${env.SAFE_BRANCH_NAME}-${env.BUILD_NUMBER}"
                }
                sh """
                    set -e
                    docker network create ${env.CI_NET}

                    # --memory caps: this box runs 6 products on hardware provisioned for 3, and
                    # its swap is full at idle (devops-infra/docs/CI_BOX_CAPACITY.md). These three
                    # are small, well-understood services sized with headroom. The test runner
                    # itself is left uncapped on purpose until its real peak is measured --
                    # guessing a ceiling there turns an OOM-kill into a fake test failure, which
                    # is exactly how build #6's lint OOM first presented.
                    docker run -d --name ${env.CI_PG} --network ${env.CI_NET} --memory=512m \
                        -e POSTGRES_USER=valuebooks -e POSTGRES_PASSWORD=ci_pw -e POSTGRES_DB=valuebooks_test \
                        postgres:17-alpine
                    docker run -d --name ${env.CI_REDIS} --network ${env.CI_NET} --memory=128m \
                        redis:7.4-alpine redis-server --appendonly yes
                    docker run -d --name ${env.CI_MINIO} --network ${env.CI_NET} --memory=512m \
                        -e MINIO_ROOT_USER=valuebooks -e MINIO_ROOT_PASSWORD=valuebooks-local \
                        quay.io/minio/minio:RELEASE.2025-07-23T15-54-02Z server /data

                    wait_for_exec() {
                        label="\$1"; container="\$2"; shift 2
                        for i in \$(seq 1 60); do
                            if docker exec "\$container" "\$@" >/dev/null 2>&1; then
                                echo "\$label ready."; return 0
                            fi
                            echo "waiting for \$label..."; sleep 2
                        done
                        echo "\$label never became ready"; docker logs "\$container" || true; return 1
                    }
                    wait_for_exec postgres ${env.CI_PG} pg_isready -U valuebooks
                    wait_for_exec redis ${env.CI_REDIS} redis-cli ping

                    # minio/minio ships neither curl nor mc, so probe from the CI image (which has
                    # node) over the CI network instead of exec-ing inside the container.
                    minio_ready=false
                    for i in \$(seq 1 60); do
                        if docker run --rm --network ${env.CI_NET} ${env.API_CI_IMAGE} \
                            node -e "fetch('http://${env.CI_MINIO}:9000/minio/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
                            minio_ready=true; echo "minio ready."; break
                        fi
                        echo "waiting for minio..."; sleep 2
                    done
                    if [ "\$minio_ready" != "true" ]; then
                        echo "minio never became ready"; docker logs ${env.CI_MINIO} || true; exit 1
                    fi

                    # StorageService.ensureBucket() creates S3_BUCKET lazily on first use, so the
                    # bucket is deliberately not pre-created here.
                    docker run --rm --network ${env.CI_NET} \
                        -e NODE_ENV=test \
                        -e DATABASE_URL=postgresql://valuebooks:ci_pw@${env.CI_PG}:5432/valuebooks_test \
                        -e DATABASE_MIGRATION_URL=postgresql://valuebooks:ci_pw@${env.CI_PG}:5432/valuebooks_test \
                        -e REDIS_URL=redis://${env.CI_REDIS}:6379 \
                        -e S3_ENDPOINT=http://${env.CI_MINIO}:9000 \
                        -e S3_REGION=us-east-1 \
                        -e S3_ACCESS_KEY=valuebooks \
                        -e S3_SECRET_KEY=valuebooks-local \
                        -e S3_BUCKET=valuebooks-test \
                        -e SECURITY_PEPPER=ci-only-jenkins-pepper-value-not-used-anywhere-else-000000 \
                        -w /app/apps/api \
                        ${env.API_CI_IMAGE} sh -c "npx prisma migrate deploy && cd /app && npm run test:integration --workspace @valuebooks/api"
                """
            }
            post {
                always {
                    sh """
                        docker rm -f ${env.CI_PG} ${env.CI_REDIS} ${env.CI_MINIO} 2>/dev/null || true
                        docker network rm ${env.CI_NET} 2>/dev/null || true
                    """
                }
            }
        }

        stage('Docker Build & Push') {
            steps {
                script {
                    def webImage = docker.build(
                        "${WEB_IMAGE_NAME}:${env.IMAGE_TAG}",
                        "--build-arg NEXT_PUBLIC_API_URL=${env.NEXT_PUBLIC_API_URL} -f apps/web/Dockerfile ."
                    )
                    def apiImage = docker.build("${API_IMAGE_NAME}:${env.IMAGE_TAG}", '-f apps/api/Dockerfile .')

                    docker.withRegistry('https://index.docker.io/v1/', 'dockerhub-credentials') {
                        webImage.push(env.IMAGE_TAG)
                        apiImage.push(env.IMAGE_TAG)
                    }
                    sh """
                        docker rmi ${WEB_IMAGE_NAME}:${env.IMAGE_TAG} ${API_IMAGE_NAME}:${env.IMAGE_TAG} 2>/dev/null || true
                    """
                }
            }
        }

        stage('Approval') {
            when { branch 'main' }
            steps {
                catchError(buildResult: 'SUCCESS', stageResult: 'SUCCESS') {
                    mail(
                        to: 'hello@lyomu.com',
                        subject: "[valuebooks] Approve PRODUCTION deploy — ${env.IMAGE_TAG} (build #${env.BUILD_NUMBER})",
                        body: """A production deployment is waiting for your approval.

  Image tag : ${env.IMAGE_TAG}
  Branch    : ${env.BRANCH_NAME}
  Build     : #${env.BUILD_NUMBER}

Review and approve (Jenkins login required):
  ${env.BUILD_URL}input
"""
                    )
                }
                input message: 'Proceed with production deploy?', ok: 'Deploy'
            }
        }

        stage('Deploy Prod') {
            when { branch 'main' }
            // Doesn't reimplement deploy logic in Groovy -- SSHes in and runs
            // the repo's own scripts/deploy.sh, so a manual break-glass deploy
            // and a Jenkins deploy are the same code path (same reasoning as
            // drift's Deploy Prod stage).
            steps {
                retry(2) {
                    withCredentials([
                        sshUserPrivateKey(credentialsId: 'valuebooks-deploy-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                    ]) {
                        sh """
                            ssh -o StrictHostKeyChecking=accept-new -i \$SSH_KEY \$SSH_USER@${env.VALUEBOOKS_PROD_HOST} \
                                "VALUEBOOKS_IMAGE_TAG=${env.IMAGE_TAG} bash /srv/valuebooks/prod/scripts/deploy.sh"
                        """
                    }
                }
            }
        }

        stage('Smoke Tests (Prod)') {
            when { branch 'main' }
            steps {
                withCredentials([sshUserPrivateKey(credentialsId: 'valuebooks-deploy-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
                    sh """
                        set -e
                        retry_check() {
                            label="\$1"; shift
                            for i in 1 2 3 4 5 6; do
                                if "\$@"; then return 0; fi
                                echo "\$label not ready yet, retrying..."; sleep 5
                            done
                            echo "\$label never became ready"
                            return 1
                        }
                        # Checked over SSH against the box's own localhost ports, not the
                        # public hostnames -- DNS/TLS for valuebooks.co may not be live yet.
                        # Switch these to curl -sf https://valuebooks.co/ and
                        # https://api.valuebooks.co/api/v1/health once they are.
                        web_up() {
                            ssh -o StrictHostKeyChecking=accept-new -i \$SSH_KEY \$SSH_USER@${env.VALUEBOOKS_PROD_HOST} \
                                "curl -sf -o /dev/null http://127.0.0.1:3001/"
                        }
                        api_up() {
                            ssh -o StrictHostKeyChecking=accept-new -i \$SSH_KEY \$SSH_USER@${env.VALUEBOOKS_PROD_HOST} \
                                "curl -sf http://127.0.0.1:3002/api/v1/health"
                        }
                        retry_check web web_up
                        retry_check api api_up
                        echo "Smoke tests passed."
                    """
                }
            }
        }
    }

    post {
        always {
            sh """
                docker rmi ${env.WEB_CI_IMAGE} ${env.API_CI_IMAGE} 2>/dev/null || true
            """
            script {
                if (env.LOCK_ACQUIRED == 'true') {
                    sh "rmdir /var/jenkins_home/valuebooks-build.lock 2>/dev/null || true"
                }
            }
        }
        failure {
            catchError(buildResult: 'FAILURE', stageResult: 'FAILURE') {
                mail(
                    to: 'hello@lyomu.com',
                    subject: "[valuebooks] Build FAILED — ${env.BRANCH_NAME} #${env.BUILD_NUMBER}",
                    body: """A build failed.

  Branch : ${env.BRANCH_NAME}
  Build  : #${env.BUILD_NUMBER}
  Commit : ${env.GIT_COMMIT?.take(7)}

Console output:
  ${env.BUILD_URL}console
"""
                )
            }
        }
    }
}
