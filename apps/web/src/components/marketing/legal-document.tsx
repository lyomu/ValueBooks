import type { ReactNode } from 'react';

type LegalSection = {
  title: string;
  content: ReactNode;
};

const contact = <a href="mailto:support@valuebooks.co">support@valuebooks.co</a>;

function LegalDocument({
  title,
  summary,
  sections,
}: {
  title: string;
  summary: string;
  sections: readonly LegalSection[];
}) {
  return (
    <article className="mk-legal">
      <header className="mk-legal__hero">
        <p className="mk-legal__draft" role="status">
          Draft — pending legal review
        </p>
        <p className="mk-kicker">VALUEBOOKS · EINSBRAND DIGITAL</p>
        <h1>{title}</h1>
        <p>{summary}</p>
      </header>
      <div className="mk-legal__body">
        <p className="mk-legal__intro">
          ValueBooks is a product of EinsBrand Digital. This draft is published for transparency
          while its final legal wording, retention periods and jurisdictional details are under
          review. Where this page says something must still be verified or decided, treat the
          surrounding text as an operational intention, not a final legal commitment.
        </p>
        {sections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {section.content}
          </section>
        ))}
      </div>
    </article>
  );
}

export function PrivacyDocument() {
  return (
    <LegalDocument
      title="Privacy Policy"
      summary="How ValueBooks collects, uses, discloses and retains personal data, and the difference between data we control directly and data our customers control."
      sections={[
        {
          title: 'Who we are and our role',
          content: (
            <>
              <p>
                ValueBooks is a business finance and accounting software product of EinsBrand
                Digital. For registration, authentication, the marketing website, service
                operations, security, support and ValueBooks subscription billing, we decide why
                and how that data is processed and act as controller.
              </p>
              <p>
                For the customers, vendors, invoices, employees and other records a subscribing
                organization enters or uploads (“Customer Content”), that organization decides
                why the data is processed and we act as a processor on its instructions. Where an
                individual appears in a subscriber’s records, requests about that data are
                ordinarily directed to the subscriber; we assist as required by law and agreement.
              </p>
            </>
          ),
        },
        {
          title: 'Information we handle',
          content: (
            <>
              <p>Depending on how you use ValueBooks, we may handle:</p>
              <ul>
                <li>
                  Registration and identity data: name, business email, login identifier,
                  credentials in protected form, email-verification information, phone number
                  where supplied, and membership roles.
                </li>
                <li>
                  Organization and business profile data: organization name, address, industry,
                  country, tax and fiscal settings, authorized users, account status and
                  subscription selection.
                </li>
                <li>
                  Customer Content: invoices, customers, vendors, bills, expenses, products,
                  banking records, attachments, projects, reports and other business records
                  entered within a workspace, which may describe third parties.
                </li>
                <li>
                  Billing data: selected plan and interval, Paystack transaction and subscription
                  references, payment status, amounts, currency and receipts. Card details are
                  entered on Paystack’s hosted payment pages; ValueBooks does not need or store
                  full card numbers or security codes.
                </li>
                <li>
                  Device and technical data: IP address, browser and device characteristics,
                  approximate network location, usage events, and session, performance and
                  security logs.
                </li>
                <li>Communications: support requests, feedback and related correspondence.</li>
                <li>
                  Cookies and similar technologies used for authentication, session security and,
                  where actually enabled, preferences or analytics.
                </li>
              </ul>
              <p>
                We do not intentionally require special-category or sensitive personal data for
                normal use, and customers should avoid placing that kind of data in free-text
                fields or attachments unless necessary and appropriately protected.
              </p>
            </>
          ),
        },
        {
          title: 'How we obtain information',
          content: (
            <p>
              We receive data directly from users and organization administrators who register,
              invite members or enter business records; automatically through use of the website
              or app; and from contracted infrastructure, authentication, support, security and
              payment providers where relevant. We receive limited transaction and subscription
              status events from Paystack, not full payment card details.
            </p>
          ),
        },
        {
          title: 'Storage and service providers',
          content: (
            <p>
              Product records are stored in a PostgreSQL database. Attachments and generated
              document artifacts use S3-compatible object storage. Email delivery is handled
              through an SMTP-compatible provider. Production hosting and provider locations may
              vary; this globally intended service does not make a data-residency promise in this
              draft.
            </p>
          ),
        },
        {
          title: 'Subscription payments',
          content: (
            <p>
              Paystack is the subscription payment processor for ValueBooks. We retain the
              provider customer, subscription and transaction references, payment status, billing
              contact details and receipts needed to operate subscriptions, reconcile payments and
              provide support. ValueBooks does not store raw card details. Paystack’s own notices
              apply to information entered on its hosted checkout pages, and Paystack may
              independently process information to authorize transactions and prevent fraud.
            </p>
          ),
        },
        {
          title: 'Confidentiality and tenant isolation',
          content: (
            <p>
              Each organization workspace is logically separated from other organizations, and
              access is restricted through role-based permissions. Platform administrators and
              contracted support personnel may access limited information when authorized and
              necessary to resolve an issue, secure the platform or comply with law; this access
              is intended to be logged and limited by least privilege. We do not sell customer
              financial records or use them to build third-party advertising profiles.
            </p>
          ),
        },
        {
          title: 'International data transfers',
          content: (
            <p>
              Depending on hosting configuration and provider locations, data may be stored,
              accessed or processed outside your country. Where international transfer
              restrictions apply, we intend to use a lawful transfer mechanism and appropriate
              safeguards. The specific hosting regions, support-access locations and transfer
              mechanisms actually in use need to be confirmed before this section is treated as
              final; see open items below.
            </p>
          ),
        },
        {
          title: 'Cookies and tracking',
          content: (
            <p>
              Essential cookies or similar technologies may be used for login, session security
              and fraud prevention. Non-essential analytics or marketing technologies, if enabled,
              will be disclosed with appropriate consent or opt-out controls where required. The
              exact cookies in use, consent-banner behavior and storage periods still need to be
              confirmed against the deployed site before this section is final.
            </p>
          ),
        },
        {
          title: 'AI processing',
          content: (
            <>
              <p>
                AI features are off by default. In private mode, ValueBooks sends requests only to
                an operator-provisioned, DeepSeek-compatible endpoint; the operator chooses that
                endpoint and its location, so private mode is not a blanket data-residency
                promise. Hosted mode is not enabled for any organization and would require a
                per-organization opt-in before report data left ValueBooks for DeepSeek’s hosted
                API.
              </p>
              <p>
                If hosted mode is ever enabled, the supported capabilities send capped report
                cells and totals that the user is authorized to view, together with the user’s
                question. They do not send attachment bytes, OCR text, authentication material,
                database credentials, or another organization’s data.
              </p>
            </>
          ),
        },
        {
          title: 'Retention',
          content: (
            <p>
              We retain information while it is needed to operate the service, meet accounting,
              security and legal obligations, or resolve disputes. Suspended, expired or canceled
              subscriptions do not automatically erase organization or Customer Content. For an
              authorized organization deletion request, ValueBooks intends a seven-day recovery
              window followed by deletion of eligible active records, with exceptions for legal
              holds, statutory retention, dispute evidence and backup lifecycles — see the Data
              Privacy &amp; Deletion Policy for the operational detail. AI-run metadata is
              separately subject to a configured retention policy; prompts and responses are not
              stored in those records. The full retention schedule, including logs, support
              messages and backup lifecycles, remains pending legal review.
            </p>
          ),
        },
        {
          title: 'Your privacy rights and how to reach us',
          content: (
            <>
              <p>
                Subject to the law that applies to you, you may have rights to access, correct,
                delete, restrict, or port your personal data, or to object to certain processing.
                Some rights have legal limitations, especially where records must be kept for
                accounting, security, dispute or legal-compliance reasons. You may also have the
                right to complain to an applicable supervisory authority.
              </p>
              <p>
                To exercise a right, or to ask about access, correction, export, deletion or
                restriction, contact {contact} and identify the relevant account or organization.
                We will verify identity and authority before acting. If your request concerns data
                controlled by one of our subscribing organizations, we may direct you to that
                organization or act on its instructions, as required. ValueBooks is built for
                business use and is not designed for children to register as account holders;
                customer organizations remain responsible for lawful handling of any minor’s data
                that appears in their own records. Any optional marketing email includes an
                unsubscribe mechanism and opting out does not affect critical operational notices.
              </p>
            </>
          ),
        },
        {
          title: 'Open questions for legal and security review',
          content: (
            <ol>
              <li>
                Registered legal entity name, registration details and address for the controller
                identity in this Policy.
              </li>
              <li>
                DeepSeek’s then-current hosted-service retention, training, subprocessors and
                breach terms, and the lawful basis and consent process for enabling hosted AI.
              </li>
              <li>A maintained subprocessors list with each provider, purpose, country and transfer mechanism.</li>
              <li>Actual data-hosting regions, support-access locations and applicable transfer safeguards.</li>
              <li>Actual cookies, tracking tools, consent-banner behavior and storage periods in production.</li>
              <li>Final retention schedule by record category, including logs, support messages and backups.</li>
              <li>Internal request-handling SLA and jurisdiction-specific response timelines.</li>
            </ol>
          ),
        },
      ]}
    />
  );
}

export function AccessibilityDocument() {
  return (
    <LegalDocument
      title="Accessibility Statement"
      summary="Our current accessibility target and how to tell us when a task is not working for you."
      sections={[
        {
          title: 'Our target',
          content: (
            <p>
              ValueBooks aims to make its web experience usable with keyboard navigation, assistive
              technologies, and a range of devices. WCAG 2.2 AA is our target. This is not a claim
              of conformance: the formal accessibility review is still pending.
            </p>
          ),
        },
        {
          title: 'How we approach accessibility',
          content: (
            <p>
              We work toward clear labels, visible focus, semantic structure, readable contrast,
              responsive layouts, and understandable feedback. Because the product changes over
              time, some journeys may still need improvement.
            </p>
          ),
        },
        {
          title: 'Report an accessibility problem',
          content: (
            <p>
              If you encounter a barrier, email {contact} with the page or task, what happened, and
              any assistive technology or browser details you are comfortable sharing. We will use
              that information to investigate and provide a practical response.
            </p>
          ),
        },
      ]}
    />
  );
}

export function TermsDocument() {
  return (
    <LegalDocument
      title="Terms and Conditions"
      summary="Draft terms for accessing and using the ValueBooks accounting, invoicing and financial-management service, pending legal review."
      sections={[
        {
          title: 'About ValueBooks and these Terms',
          content: (
            <p>
              ValueBooks is a cloud-based accounting, invoicing, recordkeeping, reporting and
              financial-management software product of EinsBrand Digital. The exact registered
              legal entity name, registration particulars and business address of the contracting
              operator still need to be inserted before this page is final. By creating an
              account, accepting these Terms, purchasing a subscription or using the service, you
              agree to them. If you use ValueBooks on behalf of an organization, you represent that
              you are authorized to bind it. The Privacy Policy and Data Privacy &amp; Deletion
              Policy supplement these Terms.
            </p>
          ),
        },
        {
          title: 'Eligibility and accounts',
          content: (
            <p>
              You must have legal capacity to enter a binding agreement, and business accounts must
              be opened and used by authorized representatives. You agree to provide accurate
              account and organization details, verify your email when requested, keep credentials
              secure, and promptly update materially inaccurate information. Each organization
              workspace is logically separated from other organizations; administrators assign
              membership and permissions and are responsible for promptly removing former staff or
              compromised accounts. We may require further identity or fraud-prevention
              verification where reasonably necessary.
            </p>
          ),
        },
        {
          title: 'What the Services provide',
          content: (
            <p>
              Depending on subscription, configuration and country, ValueBooks may provide
              invoicing, quotes, customer and vendor records, bills, expenses, product and
              inventory records, banking and reconciliation tools, accounting ledgers and reports,
              projects, automation, administrative controls and related features; some features
              may be unavailable in particular jurisdictions, subscriptions or product versions.
              ValueBooks is a software tool, not a bank, payment institution, licensed accountant,
              auditor, tax adviser or legal adviser. You remain responsible for source documents,
              financial accuracy, professional review, statutory filings and compliance with laws
              applicable to your business. Generated statements, analytics and AI-assisted output
              require review before you rely on them. A ValueBooks subscription payment is separate
              from any payment your own customers make against invoices you issue through
              ValueBooks.
            </p>
          ),
        },
        {
          title: 'Free trial',
          content: (
            <p>
              New eligible organizations may use a 14-day trial without providing a payment card.
              The trial begins once the organization has completed the required setup steps. A
              trial does not create a paid recurring subscription or authorize any charge by
              itself. We may send a trial-expiry reminder before the stated deadline. After the
              trial, if no paid subscription has been activated, the workspace moves to restricted
              read-only access: existing records remain available for permitted viewing and export,
              and billing, security and privacy controls remain accessible. One trial is ordinarily
              provided per eligible organization.
            </p>
          ),
        },
        {
          title: 'Plans and pricing',
          content: (
            <>
              <p>
                The current public plans and standard USD subscription prices are shown on the
                pricing page and at checkout, which are the authoritative source if this list and
                the live pricing ever diverge:
              </p>
              <ul>
                <li>Starter — USD 1.00/month or USD 10.00/year</li>
                <li>Growth — USD 4.99/month or USD 55.00/year</li>
                <li>Professional — USD 9.99/month or USD 100.00/year</li>
                <li>Advanced — USD 20.00/month or USD 220.00/year</li>
              </ul>
              <p>
                Annual subscriptions are charged upfront for a twelve-month period; invoice,
                customer, expense, vendor, user, bank-account, product and similar quotas described
                as monthly reset monthly unless the product states otherwise. Draft invoices do not
                count toward an issued-invoice quota until first issued. Unlimited entitlements,
                where offered, are subject to reasonable-use and technical safeguards intended to
                protect service stability, not undisclosed billing charges. When a plan limit is
                reached, we may block new actions or require an upgrade while preserving existing
                records and historical access.
              </p>
            </>
          ),
        },
        {
          title: 'Payments, recurring billing and Paystack',
          content: (
            <p>
              Paystack is the subscription payment processor for ValueBooks. When you select and
              authorize a paid subscription, Paystack handles checkout and recurring collection
              under its supported payment methods and terms, and you authorize the recurring
              payments described at checkout for your chosen plan and interval. A cardless free
              trial does not itself authorize a recurring charge. Subscriptions activate only after
              server-side payment verification; a redirect or screenshot alone is not treated as
              successful payment. Recurring charges ordinarily occur on the renewal date shown in
              billing settings. If a payment fails, we may notify you and restrict paid features
              after any grace period disclosed in the product. Do not send full card details to
              ValueBooks support; your billing area shows your plan, interval, status, renewal date
              and available receipts.
            </p>
          ),
        },
        {
          title: 'Changes of plan, cancellation and refunds',
          content: (
            <p>
              You may request an upgrade, downgrade, billing-interval change or cancellation
              through the controls available in the application, or by contacting support if
              self-service is unavailable. Before confirming a chargeable change, the interface
              discloses its effective date and any amount due; do not assume an automatic prorated
              refund or credit. Unless stated otherwise at checkout or required by law,
              cancellation stops future renewal and paid access continues until the end of the
              already-paid billing term. Canceling a subscription does not delete the organization,
              end its record-retention obligations, or start the separate deletion workflow
              described in the Data Privacy &amp; Deletion Policy. Fees already paid are generally
              non-refundable for unused time except where checkout terms, a published refund
              policy, or applicable law provide otherwise; duplicate or erroneous charges, and
              substantiated service failures, will be reviewed and corrected as required. Contact{' '}
              {contact} with the transaction reference.
            </p>
          ),
        },
        {
          title: 'Your data and content',
          content: (
            <p>
              You and your organization retain ownership of the business records, attachments,
              customer and vendor information, financial entries and other content you submit to
              the service (“Customer Content”). You grant us a limited right to host, transmit,
              process, display, back up and otherwise handle Customer Content solely to provide,
              secure, support, maintain and improve the service as described by these Terms, the
              Privacy Policy and applicable law; we do not obtain ownership of Customer Content.
              You must have a lawful basis to upload and share any personal data within Customer
              Content, and must not upload unlawful material, malicious code, or data you are not
              authorized to process. We may use aggregated or appropriately de-identified service
              statistics where lawful.
            </p>
          ),
        },
        {
          title: 'Acceptable use and security',
          content: (
            <p>
              You must not circumvent access controls or subscription entitlements, access other
              organizations’ information without permission, scrape or overload the service,
              distribute malware, use the service for fraud or illegal activity, reverse engineer
              protected portions except as law permits, exploit vulnerabilities, or disclose
              another person’s confidential information without authority. We use reasonable
              technical and organizational controls, but no internet-connected service can promise
              absolute security or uninterrupted availability. Report suspected unauthorized access
              or a vulnerability to {contact}. We may suspend access where reasonably necessary to
              address security threats, suspected misuse, payment abuse or legal demands, and will
              give notice and an opportunity to remedy the issue where legally permissible and
              safe.
            </p>
          ),
        },
        {
          title: 'Availability, updates, support and intellectual property',
          content: (
            <p>
              We aim to maintain reliable service but do not promise uninterrupted operation or a
              particular uptime absent a separately agreed service-level agreement; maintenance,
              third-party failures and events outside our reasonable control may affect access. We
              may update interfaces, correct errors, enhance security or change features, taking
              appropriate care to protect customer data and giving advance notice of material
              adverse changes when reasonably possible. Support is available via {contact}; any
              advertised support priority depends on your active plan. ValueBooks and its software,
              branding, templates and documentation are owned by EinsBrand Digital or its
              licensors, excluding Customer Content; you receive a limited, non-exclusive right to
              use them for legitimate internal business purposes while your subscription continues.
            </p>
          ),
        },
        {
          title: 'Account closure, suspension and deletion',
          content: (
            <p>
              Organization administrators may request closure and deletion through available
              controls or support, subject to identity and authority checks. A deletion request
              ordinarily causes immediate loss of normal workspace access and starts a seven-day
              recovery window, as described in the Data Privacy &amp; Deletion Policy. Records
              become eligible for deletion only after that window, subject to legal holds,
              mandatory retention, payment disputes, fraud-prevention obligations and backup
              lifecycles. Canceling billing is a separate action from requesting deletion. We may
              also suspend or end access to protect the service, address misuse, or when an account
              relationship ends.
            </p>
          ),
        },
        {
          title: 'Disclaimers, liability and indemnity',
          content: (
            <p>
              The service is provided with reasonable care and skill, but we do not guarantee that
              every report, tax treatment, automated recommendation, AI output or integration will
              always be error-free or fit a specific purpose; you must independently review
              material financial and legal decisions. An organization agrees to be responsible for
              third-party claims arising directly from its unlawful Customer Content, infringement
              of another party’s rights, or materially unauthorized use of the service, except to
              the extent caused by our negligence or wrongdoing. A proportionate,
              jurisdiction-appropriate limitation-of-liability clause — including any liability cap
              and carve-outs for fraud, willful misconduct, confidentiality and data protection —
              still needs legal review before publication; no cap is asserted in this draft.
            </p>
          ),
        },
        {
          title: 'Open questions for legal',
          content: (
            <ul>
              <li>Formal EinsBrand Digital entity details, registered address and notices contact.</li>
              <li>Governing law, venue and dispute-resolution process for a globally intended service.</li>
              <li>Final limitation-of-liability, warranty and indemnity wording.</li>
              <li>Final refund-policy wording consistent with applicable consumer law.</li>
              <li>Confirmation that in-product pricing and quotas match this page at all times.</li>
            </ul>
          ),
        },
      ]}
    />
  );
}

export function DataDeletionDocument() {
  return (
    <LegalDocument
      title="Data Privacy & Deletion Policy"
      summary="How export, account closure, organization deletion and recovery work, and what happens to retained records and backups."
      sections={[
        {
          title: 'Data categories covered',
          content: (
            <p>
              This Policy covers user account data (identity, credentials, membership history),
              organization data (business profile, subscription, settings, entitlements), Customer
              Content (invoices, customers, vendors, accounting entries and related records),
              billing and payment records, security/audit/legal records, and backup or
              disaster-recovery copies. A subscribing organization generally decides what Customer
              Content it enters; ValueBooks manages platform-level account, security and
              subscription data, subject to law and agreement.
            </p>
          ),
        },
        {
          title: 'Subscription cancellation is not data deletion',
          content: (
            <p>
              Canceling a subscription, letting one lapse, or completing the 14-day trial without
              payment does not automatically delete an account or organization. These events change
              paid-feature eligibility, not ownership or legal records. After trial expiry or loss
              of paid entitlement, normal editing may be restricted while read-only viewing/export,
              billing administration, security and privacy controls remain available. A deletion
              request is a separate, deliberate action that requires authority verification.
            </p>
          ),
        },
        {
          title: 'Who may request deletion',
          content: (
            <p>
              A user may ask to close their own account, but that does not by itself authorize
              deletion of an organization’s financial records. An organization deletion request
              must come from an owner or administrator with the required authority, and we may
              require secure re-authentication, an emailed confirmation, or evidence of authority.
              We will not execute a deletion of another person’s or organization’s data merely on
              the strength of an unverified email. Special handling applies where the requester is
              not the sole owner, where there is an ongoing dispute, or where records are subject to
              statutory retention.
            </p>
          ),
        },
        {
          title: 'Before requesting deletion',
          content: (
            <p>
              Administrators should first review organization memberships and retention duties,
              download any needed accounting, invoice, customer, vendor, inventory, banking and
              report exports the service currently supports, preserve required tax invoices and
              audit evidence, and confirm whether active billing should be canceled separately to
              avoid future charges. Exports may not cover every record relationship available in
              the product; we aim to describe actual export coverage accurately within the product
              itself rather than promising a feature that does not exist.
            </p>
          ),
        },
        {
          title: 'The seven-day deletion recovery process',
          content: (
            <>
              <p>
                Once an authorized organization deletion request has passed required security
                checks:
              </p>
              <ol>
                <li>
                  <strong>Confirmation</strong> — we record who requested deletion, the
                  organization, the request time and any stated reason, and show the intended
                  consequences before asking for explicit confirmation.
                </li>
                <li>
                  <strong>Immediate deactivation</strong> — the organization is placed in a
                  deletion-pending or equivalent restricted state; ordinary access and editing are
                  disabled, staff access is revoked or constrained as appropriate, and automated
                  jobs for that workspace are disabled.
                </li>
                <li>
                  <strong>Recovery window</strong> — a seven-day (168-hour) recovery period starts
                  at the recorded request time. During this window an authorized representative
                  may request restoration, subject to identity and security checks and whether
                  restoration remains technically and lawfully possible.
                </li>
                <li>
                  <strong>Expiration</strong> — at or after the end of the 168-hour window, the
                  organization becomes eligible for deletion of active operational data no longer
                  needed for the service or a lawful retention purpose. Deletion may be processed
                  asynchronously; the 168-hour point marks the end of recovery, not a promise of
                  instant global erasure.
                </li>
                <li>
                  <strong>Records</strong> — we keep an auditable record of the request,
                  authorization, recovery deadline, deletion actions, exceptions and outcome, and
                  can provide confirmation to the verified requester.
                </li>
              </ol>
              <p>Deadlines are calculated from a UTC timestamp and shown in the relevant configured timezone where applicable.</p>
            </>
          ),
        },
        {
          title: 'Recovery and restoration',
          content: (
            <p>
              A restoration request received before the recovery deadline may be accepted after
              confirming authority and checking for fraud, abuse, conflicting owner requests, legal
              holds and other relevant circumstances. Restoring an organization does not
              automatically reinstate a canceled Paystack subscription or reverse billing changes;
              it may restore the workspace to its previous permissible access state, including
              trial-expired or read-only status. After the recovery period and actual deletion of
              active records, complete restoration may be impossible — backups exist for disaster
              recovery and are not a guaranteed customer restore service. The exact recovery-support
              workflow and its limitations still need to be confirmed against the deployed system.
            </p>
          ),
        },
        {
          title: 'Accounting integrity and mandatory retention',
          content: (
            <p>
              Business records can carry tax, corporate, employment, anti-fraud, payment-dispute,
              bookkeeping, audit or litigation retention obligations. ValueBooks may keep
              particular data beyond a deletion request when required or justified by law, even
              though the workspace is inactive and no longer available for normal editing —
              examples include subscription transaction references, retained invoices, audit
              trails, security events, contractual acceptance records and legal holds. Any such
              exception is meant to be documented, scope-limited, access-restricted and reviewed
              for expiry; we should not keep an entire organization’s active dataset indefinitely
              just because one narrow billing record must be retained. Approved retention periods by
              record category and jurisdiction, and what ValueBooks itself must keep versus what a
              customer must independently export, remain pending legal and product sign-off.
            </p>
          ),
        },
        {
          title: 'Backups and disaster recovery',
          content: (
            <p>
              Production deletion and backup expiry may occur at different times. Protected
              backups, replication logs and disaster-recovery archives may retain copies for their
              configured lifetimes and are generally not individually edited to satisfy a routine
              account-deletion request; such copies should be access-controlled and expired under
              an approved retention schedule, and a restored backup should not reintroduce
              previously erased data indefinitely. We do not promise that all copies are
              permanently deleted within seven days; an accurate maximum backup-retention window
              will be published once the infrastructure configuration and restore workflow are
              verified.
            </p>
          ),
        },
        {
          title: 'Removing individual users and membership records',
          content: (
            <p>
              Removing a person from an organization revokes that membership’s access but preserves
              legitimate prior business records, audit trails and transaction history. A person who
              belongs to multiple organizations keeps access to the others. Closing a personal
              login affects sign-in and personal profile information; any remaining legally
              required or controller-held information is handled under the Privacy Policy and the
              applicable retention schedule. If the last owner requests deletion while an
              organization still needs an authorized owner, we expect to require ownership transfer
              or a verified organization-closure process rather than orphaning active business
              records.
            </p>
          ),
        },
        {
          title: 'Data exports and portability',
          content: (
            <p>
              Available exports may include supported CSV, PDF or other formats for invoices,
              bills, contacts, financial reports and related records. We do not promise one-click
              export of every internal database relationship unless such an export actually exists
              in the product. Export access should remain available during ordinary subscription
              expiry or read-only status where reasonably possible, but may be restricted during a
              deletion-pending state for security or where ownership is disputed.
            </p>
          ),
        },
        {
          title: 'Paystack and other third parties',
          content: (
            <p>
              ValueBooks uses Paystack to collect its own subscription fees. Deleting a ValueBooks
              account or workspace does not automatically erase records Paystack holds under its
              own contractual, fraud-prevention or legal obligations. We will take appropriate steps
              to stop unauthorized future subscription charges and to update or delete
              provider-held data where supported and legally required; requests about Paystack’s
              separately controlled payment information may need to go to Paystack directly. Other
              contracted hosting, email, monitoring and storage providers must follow their own
              applicable data-processing obligations; a maintained subprocessor inventory and
              offboarding/deletion terms are tracked as an open item below.
            </p>
          ),
        },
        {
          title: 'Requests and contact',
          content: (
            <p>
              Direct account closure, export, deletion and restoration requests to {contact},
              identifying the relevant account or organization without sending passwords, full
              payment card details, or unrequested sensitive identification documents. We may
              acknowledge the request, seek safe verification, explain applicable exceptions, and
              provide a decision or status update within applicable legal timeframes. We may also
              temporarily preserve affected records to investigate an incident, fraud, a payment
              dispute, an unauthorized deletion, or valid legal process; such holds are meant to be
              documented, access-restricted and lifted once no longer justified.
            </p>
          ),
        },
        {
          title: 'Open questions for legal and operations',
          content: (
            <ul>
              <li>Exact deletion flow and permission checks as implemented, and the seven-day countdown behavior in the live system.</li>
              <li>Organization recovery availability and the real restoration-support workflow.</li>
              <li>Actual export coverage and whether a machine-readable bulk/full-workspace export exists.</li>
              <li>Background-job cleanup, backup-expiry timing and restore behavior.</li>
              <li>Statutory retention schedule by record category and jurisdiction.</li>
              <li>Current subprocessor inventory and their deletion/offboarding terms.</li>
              <li>User-facing confirmation emails for deletion requests, recovery and completed deletion.</li>
            </ul>
          ),
        },
      ]}
    />
  );
}
