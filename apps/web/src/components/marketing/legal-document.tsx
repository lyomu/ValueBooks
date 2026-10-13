import type { ReactNode } from 'react';

type LegalSection = {
  title: string;
  content: ReactNode;
};

const contact = <a href="mailto:contact@valuebooks.co">contact@valuebooks.co</a>;

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
          while its final legal wording is under review.
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
      title="Privacy Policy & Data Deletion"
      summary="How ValueBooks handles information needed to provide accounting software, and how to ask us about it."
      sections={[
        {
          title: 'Information we handle',
          content: (
            <p>
              ValueBooks handles account and profile information; organization, accounting, and
              financial records; uploaded attachments; audit-log entries; and records needed to send
              transactional emails. We use this information to provide, secure, support, and improve
              the service for the organization that authorized access.
            </p>
          ),
        },
        {
          title: 'Storage and service providers',
          content: (
            <p>
              Product records are stored in a PostgreSQL database. Attachments and generated
              document artifacts use S3-compatible object storage. Email delivery is handled through
              an SMTP-compatible provider. Production hosting and provider locations may vary; this
              globally intended service does not make a data-residency promise in this draft.
            </p>
          ),
        },
        {
          title: 'Retention',
          content: (
            <p>
              We retain information while it is needed to operate the service, meet accounting,
              security, and legal obligations, or resolve disputes. The applicable retention
              schedule and post-termination handling remain pending legal review. AI-run metadata is
              separately subject to a configured retention policy; prompts and responses are not
              stored in those records.
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
                endpoint and its location, so private mode is not a blanket data-residency promise.
                Hosted mode is not enabled for any organization and would require a per-organization
                opt-in before report data left ValueBooks for DeepSeek’s hosted API.
              </p>
              <p>
                If hosted mode is ever enabled, the supported capabilities send capped report cells
                and totals that the user is authorized to view, together with the user’s question.
                They do not send attachment bytes, OCR text, authentication material, database
                credentials, or another organization’s data.
              </p>
            </>
          ),
        },
        {
          title: 'Open AI-review points',
          content: (
            <ol>
              <li>
                DeepSeek’s then-current hosted-service retention, training, subprocessors, and
                breach terms.
              </li>
              <li>Per-organization jurisdiction and data-residency assessment.</li>
              <li>The lawful basis and consent-capture process for hosted AI.</li>
              <li>Whether the current capped report context is sufficient data minimization.</li>
              <li>
                Hosted-mode retention and accountability, including who may enable or revoke egress.
              </li>
            </ol>
          ),
        },
        {
          title: 'Your choices, requests, and deletion',
          content: (
            <p>
              You may ask about access, correction, export, deletion, or restriction of personal
              information by contacting {contact}. Account and organization deletion requests are
              reviewed with the authorized organization and may be limited by legal, accounting,
              security, or dispute-resolution obligations. We will explain any information that must
              be retained and the next available deletion step.
            </p>
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
      title="Terms of Service"
      summary="Draft terms for using ValueBooks accounting software, pending legal review."
      sections={[
        {
          title: 'Using ValueBooks',
          content: (
            <p>
              You may use ValueBooks only for lawful business purposes and in line with the access
              permissions granted to you. You are responsible for keeping account credentials
              secure, providing accurate information, and ensuring that people you invite are
              authorized to access your organization’s records.
            </p>
          ),
        },
        {
          title: 'Your records and our service',
          content: (
            <p>
              You retain responsibility for your financial records and decisions made from them.
              ValueBooks provides software tools, not accounting, tax, legal, or regulatory advice.
              We may update, maintain, or change the service to protect its security and
              reliability, and will aim to communicate material changes where appropriate.
            </p>
          ),
        },
        {
          title: 'Acceptable use and intellectual property',
          content: (
            <p>
              Do not misuse the service, interfere with its operation, attempt unauthorized access,
              or use it to infringe another person’s rights. ValueBooks and its software, branding,
              and documentation remain the property of EinsBrand Digital or its licensors; you
              receive a limited right to use them while your authorized access continues.
            </p>
          ),
        },
        {
          title: 'Availability, fees, and liability',
          content: (
            <p>
              Pricing, service commitments, warranties, liability limits, and remedies require legal
              review before they are final. This draft does not promise uninterrupted service or
              establish a final commercial agreement.
            </p>
          ),
        },
        {
          title: 'Suspension and termination',
          content: (
            <p>
              Access may be suspended or ended to protect the service, address misuse, or when an
              account relationship ends. The final process for notice, data export, retention, and
              deletion remains subject to the reviewed terms and applicable obligations.
            </p>
          ),
        },
        {
          title: 'Open questions for legal',
          content: (
            <ul>
              <li>
                Governing law, venue, and dispute-resolution process for a globally intended
                service.
              </li>
              <li>Formal EinsBrand Digital entity details and notices address.</li>
              <li>Subscription, payment, tax, service-level, and refund terms.</li>
              <li>Final retention, export, and deletion commitments after termination.</li>
              <li>Final warranty, indemnity, liability, and suspension wording.</li>
            </ul>
          ),
        },
      ]}
    />
  );
}
