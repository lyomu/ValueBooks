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
            // Root-level eslint covers every workspace in one pass -- the api
            // CI image has prisma generate already run, so it's the superset
            // both web and api lint checks can run from.
            steps {
                sh "docker run --rm ${env.API_CI_IMAGE} npm run lint"
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
            steps {
                script {
                    env.CI_NET = "valuebooks-ci-net-${env.SAFE_BRANCH_NAME}-${env.BUILD_NUMBER}"
                    env.CI_PG = "valuebooks-ci-postgres-${env.SAFE_BRANCH_NAME}-${env.BUILD_NUMBER}"
                }
                sh """
                    set -e
                    docker network create ${env.CI_NET}
                    docker run -d --name ${env.CI_PG} --network ${env.CI_NET} \
                        -e POSTGRES_USER=valuebooks -e POSTGRES_PASSWORD=ci_pw -e POSTGRES_DB=valuebooks_test \
                        postgres:17-alpine
                    ready=false
                    for i in \$(seq 1 60); do
                        if docker exec ${env.CI_PG} pg_isready -U valuebooks >/dev/null 2>&1; then
                            ready=true
                            break
                        fi
                        echo "waiting for postgres..."; sleep 2
                    done
                    if [ "\$ready" != "true" ]; then
                        echo "postgres never became ready"
                        docker logs ${env.CI_PG} || true
                        exit 1
                    fi
                    docker run --rm --network ${env.CI_NET} \
                        -e NODE_ENV=test \
                        -e DATABASE_URL=postgresql://valuebooks:ci_pw@${env.CI_PG}:5432/valuebooks_test \
                        -e DATABASE_MIGRATION_URL=postgresql://valuebooks:ci_pw@${env.CI_PG}:5432/valuebooks_test \
                        -e SECURITY_PEPPER=ci-only-jenkins-pepper-value-not-used-anywhere-else-000000 \
                        -w /app/apps/api \
                        ${env.API_CI_IMAGE} sh -c "npx prisma migrate deploy && cd /app && npm run test:integration --workspace @valuebooks/api"
                """
            }
            post {
                always {
                    sh "docker rm -f ${env.CI_PG} 2>/dev/null || true; docker network rm ${env.CI_NET} 2>/dev/null || true"
                }
            }
        }

        stage('Docker Build') {
            steps {
                script {
                    docker.build(
                        "${WEB_IMAGE_NAME}:${env.IMAGE_TAG}",
                        "--build-arg NEXT_PUBLIC_API_URL=${env.NEXT_PUBLIC_API_URL} -f apps/web/Dockerfile ."
                    )
                    docker.build("${API_IMAGE_NAME}:${env.IMAGE_TAG}", '-f apps/api/Dockerfile .')
                }
            }
        }

        // Catches "image builds green but the container doesn't actually boot" --
        // the first prod deploy (sha-64891966aadb) crash-looped api/worker/
        // document-extraction-worker with "Cannot find module '@valuebooks/config'"
        // because apps/api/Dockerfile's runtime stage copied node_modules but not the
        // packages/* dirs its workspace symlinks pointed to (fixed in PR #47).
        // `docker build --target build` already validates the Next/Nest build compiles
        // (see 'Build CI images' above) but never actually runs the runtime image, so
        // it couldn't have caught this. Runs before Docker Push so a bad image never
        // reaches Docker Hub or prod.
        stage('Smoke Test (Image Boot)') {
            steps {
                script {
                    env.SMOKE_NET = "valuebooks-smoke-net-${env.SAFE_BRANCH_NAME}-${env.BUILD_NUMBER}"
                    env.SMOKE_PG = "valuebooks-smoke-postgres-${env.SAFE_BRANCH_NAME}-${env.BUILD_NUMBER}"
                    env.SMOKE_REDIS = "valuebooks-smoke-redis-${env.SAFE_BRANCH_NAME}-${env.BUILD_NUMBER}"
                    env.SMOKE_API = "valuebooks-smoke-api-${env.SAFE_BRANCH_NAME}-${env.BUILD_NUMBER}"
                    env.SMOKE_WEB = "valuebooks-smoke-web-${env.SAFE_BRANCH_NAME}-${env.BUILD_NUMBER}"
                }
                sh """
                    set -e
                    docker network create ${env.SMOKE_NET}
                    docker run -d --name ${env.SMOKE_PG} --network ${env.SMOKE_NET} \
                        -e POSTGRES_USER=valuebooks -e POSTGRES_PASSWORD=smoke_pw -e POSTGRES_DB=valuebooks_smoke \
                        postgres:17-alpine
                    docker run -d --name ${env.SMOKE_REDIS} --network ${env.SMOKE_NET} redis:7.4-alpine

                    ready=false
                    for i in \$(seq 1 60); do
                        if docker exec ${env.SMOKE_PG} pg_isready -U valuebooks >/dev/null 2>&1; then ready=true; break; fi
                        echo "waiting for smoke postgres..."; sleep 2
                    done
                    if [ "\$ready" != "true" ]; then
                        echo "smoke postgres never became ready"; docker logs ${env.SMOKE_PG} || true; exit 1
                    fi

                    ready=false
                    for i in \$(seq 1 30); do
                        if docker exec ${env.SMOKE_REDIS} redis-cli ping 2>/dev/null | grep -q PONG; then ready=true; break; fi
                        echo "waiting for smoke redis..."; sleep 1
                    done
                    if [ "\$ready" != "true" ]; then
                        echo "smoke redis never became ready"; docker logs ${env.SMOKE_REDIS} || true; exit 1
                    fi

                    # NODE_ENV=test, not production -- @valuebooks/config's LOCAL_DEFAULTS then fill
                    # every other required var (SECURITY_PEPPER, S3_*, SMTP_*, CLAMAV_HOST,
                    # WEB_APP_URL); only DATABASE_URL/REDIS_URL need overriding, to point at these
                    # throwaway containers instead of the config package's literal localhost default.
                    docker run -d --name ${env.SMOKE_API} --network ${env.SMOKE_NET} \
                        -e NODE_ENV=test \
                        -e DATABASE_URL=postgresql://valuebooks:smoke_pw@${env.SMOKE_PG}:5432/valuebooks_smoke \
                        -e REDIS_URL=redis://${env.SMOKE_REDIS}:6379 \
                        -e SECURITY_PEPPER=smoke-only-jenkins-pepper-value-not-used-anywhere-else-000000 \
                        -e NEXT_PUBLIC_API_URL=${env.NEXT_PUBLIC_API_URL} \
                        ${API_IMAGE_NAME}:${env.IMAGE_TAG}

                    docker run -d --name ${env.SMOKE_WEB} --network ${env.SMOKE_NET} ${WEB_IMAGE_NAME}:${env.IMAGE_TAG}

                    retry_check() {
                        label="\$1"; container="\$2"; url="\$3"
                        for i in 1 2 3 4 5 6 7 8 9 10; do
                            if docker run --rm --network ${env.SMOKE_NET} curlimages/curl:8.11.0 -sf -o /dev/null "\$url"; then
                                return 0
                            fi
                            echo "\$label not up yet, retrying..."; sleep 3
                        done
                        echo "\$label never came up -- image builds but the container doesn't boot (see PR #47 incident notes above)"
                        docker logs "\$container" || true
                        return 1
                    }

                    retry_check api ${env.SMOKE_API} "http://${env.SMOKE_API}:3001/api/v1/health"
                    retry_check web ${env.SMOKE_WEB} "http://${env.SMOKE_WEB}:3000/"
                    echo "Image boot smoke test passed."
                """
            }
            post {
                always {
                    sh """
                        docker rm -f ${env.SMOKE_API} ${env.SMOKE_WEB} ${env.SMOKE_PG} ${env.SMOKE_REDIS} 2>/dev/null || true
                        docker network rm ${env.SMOKE_NET} 2>/dev/null || true
                    """
                }
            }
        }

        stage('Docker Push') {
            steps {
                script {
                    docker.withRegistry('https://index.docker.io/v1/', 'dockerhub-credentials') {
                        sh """
                            docker push ${WEB_IMAGE_NAME}:${env.IMAGE_TAG}
                            docker push ${API_IMAGE_NAME}:${env.IMAGE_TAG}
                        """
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
                script {
                    // Build #16 failed here with "ssh: Could not resolve hostname null" --
                    // VALUEBOOKS_PROD_HOST was never set as a Jenkins global env var, so it
                    // interpolated as the literal string "null". Fail fast with a clear message
                    // instead of letting it reach ssh ...@null.
                    if (!env.VALUEBOOKS_PROD_HOST?.trim()) {
                        error("VALUEBOOKS_PROD_HOST is not set — configure it under Manage Jenkins > System before deploying.")
                    }
                }
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
