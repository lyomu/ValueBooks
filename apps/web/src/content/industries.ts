export type IndustryAsset = {
  assetId: string;
  alt: string;
  description: string;
  slot: 'primary' | 'supporting' | 'product';
};

export type Industry = {
  slug: string;
  name: string;
  shortDescription: string;
  seoTitle: string;
  metaDescription: string;
  hero: { title: string; description: string };
  introduction: { heading: string; paragraphs: [string, string] };
  challenges: { title: string; description: string }[];
  benefits: { title: string; description: string }[];
  features: string[];
  workflow: { title: string; steps: string[] };
  faqs: { q: string; a: string }[];
  assets: IndustryAsset[];
};

const registry: Industry[] = [
  {
    slug: 'retail',
    name: 'Retail',
    shortDescription: 'Keep sales, purchases, expenses, and financial records organized.',
    seoTitle: 'Accounting Software for Retail Businesses | ValueBooks',
    metaDescription:
      "Keep retail sales, purchases, stock costs, and expenses organized with ValueBooks. Understand your store's finances and make informed business decisions.",
    hero: {
      title: 'Clearer finances for your retail business.',
      description:
        'Keep sales, expenses, stock costs, and financial records connected. ValueBooks helps you understand how your retail business is performing, from daily activity to long-term growth.',
    },
    introduction: {
      heading: 'Running a store takes more than making sales.',
      paragraphs: [
        'Every day brings new transactions, supplier deliveries, operating expenses, and decisions about what to stock next. When these financial activities are tracked separately, it becomes difficult to understand how much the business is actually earning.',
        'ValueBooks helps retail businesses maintain organized financial records, track business expenses, manage purchasing activity, and review the numbers behind daily operations. Instead of relying on disconnected spreadsheets, you can work with a clearer picture of your business finances.',
      ],
    },
    challenges: [
      {
        title: 'Sales without financial clarity.',
        description:
          'Strong sales figures do not always mean strong profits. Rent, supplier costs, wages, and other expenses all affect what the business actually keeps.',
      },
      {
        title: 'Purchases and stock costs.',
        description:
          'Buying stock from multiple suppliers creates financial records that need to stay organized, from purchase orders and bills to payments and inventory costs.',
      },
      {
        title: 'Untracked daily expenses.',
        description:
          'Small recurring expenses can add up quickly. Without consistent tracking, they can quietly reduce profitability.',
      },
      {
        title: 'Preparing reliable financial reports.',
        description:
          'Owners need more than transaction totals. They need financial reports that explain income, expenses, outstanding obligations, and overall performance.',
      },
    ],
    benefits: [
      {
        title: 'Keep financial activity organized.',
        description:
          'Record business income, expenses, bills, and supplier transactions in a connected accounting system.',
      },
      {
        title: 'Understand profitability.',
        description:
          'Review income and expense reports to see how operating costs affect your business.',
      },
      {
        title: 'Manage purchasing.',
        description:
          'Organize supplier bills and purchase records without losing visibility into what you owe.',
      },
      {
        title: 'Make informed decisions.',
        description:
          'Use financial reports and insights to support decisions about costs, purchasing, and growth.',
      },
    ],
    features: [
      'Sales and invoice management',
      'Expense tracking',
      'Purchase orders and supplier bills',
      'Inventory management (eligible plans)',
      'Profit and loss reports',
      'Financial dashboard',
    ],
    workflow: {
      title: 'From everyday activity to a clearer financial picture',
      steps: [
        'Record sales and issued invoices.',
        'Capture supplier purchases and operating expenses.',
        'Update inventory records where inventory management is enabled.',
        'Review financial reports to understand profitability and obligations.',
      ],
    },
    faqs: [
      {
        q: 'Can ValueBooks help manage supplier bills?',
        a: 'Yes. Supported plans include purchasing and bill-management capabilities for recording obligations to suppliers and monitoring payments.',
      },
      {
        q: 'Can I track retail inventory?',
        a: 'Inventory capabilities are available according to the selected subscription plan.',
      },
      {
        q: 'Does ValueBooks replace my POS?',
        a: 'ValueBooks is primarily an accounting and financial management platform. Do not present it as a complete retail checkout system unless the relevant POS functionality or integration is actually available.',
      },
    ],
    assets: [
      {
        assetId: 'retail-primary',
        slot: 'primary',
        description:
          'Modern independent retail shop with neat merchandise, shelves and checkout counter.',
        alt: 'Independent retail shop with neatly arranged merchandise and a checkout counter',
      },
      {
        assetId: 'retail-supporting',
        slot: 'supporting',
        description: 'Owner reviewing purchase and finance records.',
        alt: 'Retail owner reviewing purchase and finance records',
      },
      {
        assetId: 'retail-product',
        slot: 'product',
        description: 'Authentic ValueBooks financial dashboard or sales and expense overview.',
        alt: 'ValueBooks financial dashboard showing demo retail information',
      },
    ],
  },
  {
    slug: 'ecommerce',
    name: 'E-commerce',
    shortDescription: 'Understand online business income, purchasing costs, and expenses.',
    seoTitle: 'Accounting Software for E-commerce Businesses | ValueBooks',
    metaDescription:
      'Organize online sales, business expenses, purchasing, and financial reporting with ValueBooks. Built for e-commerce businesses managing growth.',
    hero: {
      title: 'Keep your online business finances in order.',
      description:
        'From customer invoices to fulfillment expenses and supplier purchases, ValueBooks helps you keep your e-commerce financial activity organized as your business grows.',
    },
    introduction: {
      heading: 'Online growth needs financial visibility.',
      paragraphs: [
        'Running an online business involves much more than receiving orders. Product costs, packaging, shipping, marketing, returns, supplier payments, and operating expenses all affect profitability.',
        'ValueBooks gives e-commerce businesses a structured place to record financial activity and understand business performance. Keep transactions organized and review the reports that help you make better pricing, purchasing, and spending decisions.',
      ],
    },
    challenges: [
      {
        title: 'Many moving costs.',
        description:
          'Advertising, delivery, packaging, platform fees, and product purchases can affect margins.',
      },
      {
        title: 'Complex purchasing activity.',
        description:
          'Multiple suppliers and changing purchasing costs make financial organization important.',
      },
      {
        title: 'Customer refunds and adjustments.',
        description: 'Returns and credit notes need to be reflected accurately.',
      },
      {
        title: 'Understanding actual profitability.',
        description: 'Revenue alone does not explain business performance.',
      },
    ],
    benefits: [
      {
        title: 'Organize customer transactions.',
        description: 'Maintain accurate invoices, credit notes, and payment records.',
      },
      {
        title: 'Track operating costs.',
        description: 'Keep marketing, shipping, packaging, and other business expenses visible.',
      },
      {
        title: 'Manage supplier activity.',
        description: 'Record purchases, supplier bills, and outstanding balances.',
      },
      {
        title: 'Review financial performance.',
        description: 'Use reports to understand income, expenses, and profitability.',
      },
    ],
    features: [
      'Invoices and credit notes',
      'Expense management',
      'Purchase orders and bills',
      'Inventory records (eligible plans)',
      'Customer and vendor management',
      'Financial reporting',
    ],
    workflow: {
      title: 'A connected view of online activity',
      steps: [
        'Record customer invoices and payment activity.',
        'Track supplier costs, delivery costs, and operating expenses.',
        'Process returns or adjustments through appropriate financial records.',
        'Review profitability and outstanding balances.',
      ],
    },
    faqs: [
      {
        q: 'Can I record shipping and advertising costs?',
        a: 'Yes. These can be recorded as business expenses using appropriate accounts and categories.',
      },
      {
        q: 'Can ValueBooks handle customer refunds?',
        a: 'Credit notes and related financial records can support accounting for customer adjustments, subject to implemented workflows.',
      },
      {
        q: 'Does ValueBooks automatically import orders from my online store?',
        a: 'Only advertise automatic order imports if a supported e-commerce integration has actually been implemented.',
      },
    ],
    assets: [
      {
        assetId: 'ecommerce-primary',
        slot: 'primary',
        description: 'E-commerce workspace with parcels, labels and order packing.',
        alt: 'E-commerce workspace with parcels, labels, and order packing materials',
      },
      {
        assetId: 'ecommerce-supporting',
        slot: 'supporting',
        description: 'Owner reviewing orders and expenses on laptop.',
        alt: 'E-commerce owner reviewing orders and expenses on a laptop',
      },
      {
        assetId: 'ecommerce-product',
        slot: 'product',
        description: 'Authentic ValueBooks invoice or expense listing.',
        alt: 'ValueBooks invoice or expense listing with demo information',
      },
    ],
  },
  {
    slug: 'agencies-consultants',
    name: 'Agencies & Consultants',
    shortDescription: 'Manage client billing, project costs, and financial performance.',
    seoTitle: 'Accounting Software for Agencies and Consultants | ValueBooks',
    metaDescription:
      'Manage client billing, project expenses, business costs, and profitability with ValueBooks. Financial clarity for agencies and consulting businesses.',
    hero: {
      title: 'More clarity behind every client project.',
      description:
        'Keep client invoices, project costs, expenses, and financial performance organized. ValueBooks helps agencies and consultants spend less time on administration and more time delivering valuable work.',
    },
    introduction: {
      heading: 'Your best work deserves better financial organization.',
      paragraphs: [
        'Agencies and consultants often juggle several clients, projects, invoices, and operating expenses at the same time. As the workload grows, understanding what has been billed, what remains unpaid, and which projects are profitable becomes increasingly important.',
        'ValueBooks helps you organize your financial workflows, monitor outstanding client payments, and connect project-related activity with broader business reporting.',
      ],
    },
    challenges: [
      {
        title: 'Managing multiple client engagements.',
        description: 'Different projects may have different billing schedules and expenses.',
      },
      {
        title: 'Tracking outstanding invoices.',
        description: 'Delayed payments can affect business cash flow.',
      },
      {
        title: 'Understanding project profitability.',
        description: 'Revenue does not always reflect the actual cost of delivering work.',
      },
      {
        title: 'Managing recurring expenses.',
        description:
          'Software subscriptions, contractors, and operational costs require consistent tracking.',
      },
    ],
    benefits: [
      {
        title: 'Keep client billing organized.',
        description: 'Prepare invoices, track payments, and maintain clear records.',
      },
      {
        title: 'Monitor project costs.',
        description:
          'Associate relevant expenses with project activity where project features are available.',
      },
      {
        title: 'Understand project performance.',
        description: 'Review income and costs to evaluate profitability.',
      },
      {
        title: 'Stay ahead of cash flow.',
        description: 'Monitor outstanding receivables and upcoming financial obligations.',
      },
    ],
    features: [
      'Client management',
      'Quotes and invoices',
      'Recurring invoicing (eligible plans)',
      'Project management (Growth and above)',
      'Timesheets (Growth and above)',
      'Project profitability reporting (Growth and above)',
    ],
    workflow: {
      title: 'A clearer client-project workflow',
      steps: [
        'Create a quote for a client engagement.',
        'Issue an invoice according to the agreed scope or billing schedule.',
        'Record project-related costs and time where supported.',
        'Review outstanding invoices and project profitability.',
      ],
    },
    faqs: [
      {
        q: 'Can I invoice different clients separately?',
        a: 'Yes. ValueBooks supports customer records and associated invoices.',
      },
      {
        q: 'Can I track profitability for each project?',
        a: 'Project profitability features begin with Growth, subject to the finalized plan configuration.',
      },
      {
        q: 'Can ValueBooks support recurring client invoices?',
        a: 'Recurring invoice functionality is available on eligible plans.',
      },
    ],
    assets: [
      {
        assetId: 'agencies-consultants-primary',
        slot: 'primary',
        description:
          'Creative agency or consulting team collaborating in a professional workspace.',
        alt: 'Agency and consulting team collaborating in a professional workspace',
      },
      {
        assetId: 'agencies-consultants-supporting',
        slot: 'supporting',
        description: 'Consultant reviewing project budget.',
        alt: 'Consultant reviewing a project budget',
      },
      {
        assetId: 'agencies-consultants-product',
        slot: 'product',
        description: 'Authentic ValueBooks projects or project profitability screen.',
        alt: 'ValueBooks projects or profitability screen with demo information',
      },
    ],
  },
  {
    slug: 'restaurants-hospitality',
    name: 'Restaurants & Hospitality',
    shortDescription: 'Stay on top of supplier purchases and daily operating expenses.',
    seoTitle: 'Accounting for Restaurants and Hospitality | ValueBooks',
    metaDescription:
      'Track restaurant expenses, supplier bills, purchasing costs, and financial performance with ValueBooks. Keep your hospitality business finances organized.',
    hero: {
      title: 'Better financial visibility for hospitality.',
      description:
        'Keep supplier expenses, operating costs, purchasing records, and financial reports organized. ValueBooks helps restaurants and hospitality businesses understand the numbers behind their daily operations.',
    },
    introduction: {
      heading: 'Every service day has a financial story.',
      paragraphs: [
        'Restaurants, cafés, catering businesses, and hospitality operators manage a continuous flow of purchases, expenses, supplier payments, and revenue. From ingredients and consumables to utilities and staffing costs, financial activity can quickly become difficult to track.',
        'ValueBooks helps you organize accounting records and understand where your business spends money. With clearer reporting, you can assess profitability and make more informed operating decisions.',
      ],
    },
    challenges: [
      {
        title: 'Frequent supplier purchases.',
        description:
          'Ingredients, consumables, and other supplies involve regular bills and payments.',
      },
      {
        title: 'Changing operating expenses.',
        description: 'Utilities, maintenance, staffing, and other costs affect margins.',
      },
      {
        title: 'Understanding profitability.',
        description: 'Sales volume is only part of the financial picture.',
      },
      {
        title: 'Keeping financial records current.',
        description: 'Busy operating environments can leave little time for bookkeeping.',
      },
    ],
    benefits: [
      {
        title: 'Track operational spending.',
        description: 'Record recurring and one-off operating expenses.',
      },
      {
        title: 'Keep suppliers organized.',
        description: 'Maintain vendor records and purchase documentation.',
      },
      {
        title: 'Monitor financial performance.',
        description: 'Review expense categories and profit and loss reports.',
      },
      {
        title: 'Support better cost decisions.',
        description: 'Understand how purchasing and operational costs affect performance.',
      },
    ],
    features: [
      'Expense tracking',
      'Vendor management',
      'Supplier bills',
      'Purchase orders',
      'Inventory management (eligible plans)',
      'Profit and loss reports',
    ],
    workflow: {
      title: 'From service day to financial review',
      steps: [
        'Record business sales through the supported accounting workflow.',
        'Capture supplier bills and expense records.',
        'Categorize operating costs.',
        'Review financial performance and outstanding bills.',
      ],
    },
    faqs: [
      {
        q: 'Can ValueBooks track food and supply purchases?',
        a: 'Yes. Supplier purchases and related expenses can be recorded using purchasing and accounting features.',
      },
      {
        q: 'Can I track different expense categories?',
        a: 'Yes. Use the chart of accounts and expense categorization available to your plan.',
      },
      {
        q: 'Does ValueBooks include restaurant table ordering?',
        a: 'Do not claim that it does unless a restaurant ordering module has actually been implemented.',
      },
    ],
    assets: [
      {
        assetId: 'restaurants-hospitality-primary',
        slot: 'primary',
        description: 'Warm modern restaurant or café interior.',
        alt: 'Warm modern restaurant or café interior',
      },
      {
        assetId: 'restaurants-hospitality-supporting',
        slot: 'supporting',
        description: 'Manager reviewing suppliers paperwork.',
        alt: 'Restaurant manager reviewing supplier paperwork',
      },
      {
        assetId: 'restaurants-hospitality-product',
        slot: 'product',
        description: 'Authentic ValueBooks purchasing or expenses screen.',
        alt: 'ValueBooks purchasing or expenses screen with demo information',
      },
    ],
  },
  {
    slug: 'construction-trades',
    name: 'Construction & Trades',
    shortDescription: 'Track job costs, client billing, and project financial performance.',
    seoTitle: 'Accounting Software for Construction and Trades | ValueBooks',
    metaDescription:
      'Organize project costs, supplier bills, contractor expenses, and financial reporting with ValueBooks. Accounting visibility for construction and trade businesses.',
    hero: {
      title: 'Keep project finances under control.',
      description:
        'From materials and supplier bills to client invoices and project expenses, ValueBooks helps construction and trade businesses stay organized and understand project financial performance.',
    },
    introduction: {
      heading: 'Know where the money goes on every job.',
      paragraphs: [
        'Construction businesses and skilled trades work with changing material costs, suppliers, contractors, and client payment schedules. Without organized records, it becomes difficult to understand job costs and the financial health of the business.',
        'ValueBooks helps you manage purchasing, invoices, expenses, and accounting activity. Eligible project-management features also help connect project costs with profitability reporting.',
      ],
    },
    challenges: [
      { title: 'Material costs.', description: 'Purchases can vary between jobs and suppliers.' },
      {
        title: 'Project-specific spending.',
        description: 'Expenses need to be attributed accurately.',
      },
      {
        title: 'Customer billing.',
        description: 'Progress payments and invoicing require organized financial records.',
      },
      {
        title: 'Profitability visibility.',
        description: 'A completed job may not be profitable if costs are underestimated.',
      },
    ],
    benefits: [
      {
        title: 'Organize project expenses.',
        description: 'Associate costs with projects where supported.',
      },
      {
        title: 'Manage client billing.',
        description: 'Maintain quotes, invoices, and outstanding balances.',
      },
      { title: 'Keep supplier records connected.', description: 'Track purchases and bills.' },
      {
        title: 'Evaluate project outcomes.',
        description: 'Review profitability and financial reports.',
      },
    ],
    features: [
      'Quotes and invoices',
      'Purchase orders',
      'Vendor bills',
      'Project expense tracking (Growth+)',
      'Timesheets (Growth+)',
      'Project profitability (Growth+)',
    ],
    workflow: {
      title: 'A practical job-cost workflow',
      steps: [
        'Prepare a customer quote.',
        'Record supplier purchases and job-related expenses.',
        'Issue invoices for completed work or agreed milestones through supported billing workflows.',
        'Evaluate project revenue and costs.',
      ],
    },
    faqs: [
      {
        q: 'Can expenses be assigned to a construction project?',
        a: 'Yes, where project expense tracking is available.',
      },
      {
        q: 'Can I track several projects?',
        a: 'Growth supports up to 25 active projects under the proposed subscription structure.',
      },
      {
        q: 'Does ValueBooks provide construction scheduling or site management?',
        a: 'Do not represent ValueBooks as a construction scheduling platform unless those capabilities are implemented.',
      },
    ],
    assets: [
      {
        assetId: 'construction-trades-primary',
        slot: 'primary',
        description: 'Building professional reviewing plans on job site.',
        alt: 'Construction professional reviewing plans at a job site',
      },
      {
        assetId: 'construction-trades-supporting',
        slot: 'supporting',
        description: 'Tradesperson reviewing materials invoices.',
        alt: 'Tradesperson reviewing materials invoices',
      },
      {
        assetId: 'construction-trades-product',
        slot: 'product',
        description: 'Authentic ValueBooks project financial detail.',
        alt: 'ValueBooks project financial detail with demo information',
      },
    ],
  },
  {
    slug: 'professional-services',
    name: 'Professional Services',
    shortDescription: 'Keep client invoices, expenses, and receivables connected.',
    seoTitle: 'Accounting Software for Professional Services | ValueBooks',
    metaDescription:
      'Manage client invoicing, expenses, receivables, and financial reporting with ValueBooks. Practical accounting for professional service businesses.',
    hero: {
      title: 'Financial clarity for the work you deliver.',
      description:
        'Manage client invoices, business expenses, outstanding payments, and financial reporting in one organized platform designed for service-based businesses.',
    },
    introduction: {
      heading: 'Focus on your clients, not scattered financial records.',
      paragraphs: [
        'Professional service businesses rely on accurate client billing, timely payments, and a clear understanding of operating costs. As client engagements grow, spreadsheets and disconnected systems can make financial administration unnecessarily time-consuming.',
        'ValueBooks helps professional service providers maintain consistent accounting records, organize customer billing, and review business financial performance with greater confidence.',
      ],
    },
    challenges: [
      {
        title: 'Tracking client receivables.',
        description: 'Outstanding invoices need clear follow-up.',
      },
      {
        title: 'Recording professional expenses.',
        description: 'Operating costs and subscriptions affect profitability.',
      },
      {
        title: 'Managing regular billing.',
        description: 'Different clients may require different invoice cycles.',
      },
      {
        title: 'Preparing financial statements.',
        description: 'Accurate reporting supports better decisions.',
      },
    ],
    benefits: [
      { title: 'Organize invoicing.', description: 'Keep customer billing records accessible.' },
      { title: 'Track payments.', description: 'See outstanding receivables.' },
      {
        title: 'Manage business expenses.',
        description: 'Record the costs of delivering professional services.',
      },
      { title: 'Review performance.', description: 'Access financial reports and dashboards.' },
    ],
    features: [
      'Customer management',
      'Quotes and invoicing',
      'Recurring invoices (eligible plans)',
      'Payment tracking',
      'Expense management',
      'Financial statements',
    ],
    workflow: {
      title: 'A simpler client-finance rhythm',
      steps: [
        'Add client details.',
        'Issue quotes or invoices.',
        'Record received payments and operating expenses.',
        'Review receivables and financial reports.',
      ],
    },
    faqs: [
      {
        q: 'Can I use ValueBooks for recurring client billing?',
        a: 'Yes, with an eligible subscription plan.',
      },
      {
        q: 'Can I manage multiple clients?',
        a: 'Yes, subject to the customer limit of the selected plan.',
      },
      {
        q: 'Can I generate financial statements?',
        a: 'ValueBooks includes financial reporting capabilities, with report availability determined by plan.',
      },
    ],
    assets: [
      {
        assetId: 'professional-services-primary',
        slot: 'primary',
        description: 'Consultants and professionals in a calm office.',
        alt: 'Professional services team in a calm office',
      },
      {
        assetId: 'professional-services-supporting',
        slot: 'supporting',
        description: 'Organized desk with client documentation.',
        alt: 'Organized desk with client documentation',
      },
      {
        assetId: 'professional-services-product',
        slot: 'product',
        description: 'Authentic ValueBooks customer detail or receivables screen.',
        alt: 'ValueBooks customer detail or receivables screen with demo information',
      },
    ],
  },
  {
    slug: 'freelancers',
    name: 'Freelancers',
    shortDescription: 'Make invoicing, payment tracking, and expense management simpler.',
    seoTitle: 'Accounting and Invoicing Software for Freelancers | ValueBooks',
    metaDescription:
      'Create invoices, track freelance income and expenses, and stay organized with ValueBooks. Simple financial management for independent professionals.',
    hero: {
      title: 'Your work is independent. Your finances can be organized.',
      description:
        'Create professional invoices, keep track of client payments, and manage your business expenses without complicated financial administration.',
    },
    introduction: {
      heading: 'Spend more time doing the work you love.',
      paragraphs: [
        'As a freelancer, you are responsible for delivering great work and running the business behind it. That means finding clients, preparing quotations, sending invoices, tracking payments, and staying on top of expenses.',
        'ValueBooks gives you a straightforward way to organize the financial side of freelancing. Keep important records in one place and build a clearer picture of what you earn and spend.',
      ],
    },
    challenges: [
      {
        title: 'Getting invoices out on time.',
        description: 'Manual invoicing can delay payment requests.',
      },
      {
        title: 'Knowing who has paid.',
        description: 'Multiple clients create outstanding balances to monitor.',
      },
      {
        title: 'Mixing business expenses.',
        description: 'Software, equipment, travel, and other expenses can be overlooked.',
      },
      {
        title: 'Understanding income.',
        description: 'Freelancers need a clear view of earnings after business costs.',
      },
    ],
    benefits: [
      {
        title: 'Create professional invoices.',
        description: 'Present clear payment requests to clients.',
      },
      { title: 'Track client balances.', description: 'Monitor invoices and record payments.' },
      {
        title: 'Organize business expenses.',
        description: 'Keep business-related spending documented.',
      },
      {
        title: 'Understand your earnings.',
        description: 'Use financial reports to review business performance.',
      },
    ],
    features: [
      'Professional invoices',
      'Customer management',
      'Quotes',
      'Payment recording',
      'Expense tracking',
      'Profit and loss reporting',
    ],
    workflow: {
      title: 'From client work to clear records',
      steps: [
        'Create a customer record and prepare a quote.',
        'Issue an invoice when appropriate.',
        'Record payment once received.',
        'Track work-related expenses and review income.',
      ],
    },
    faqs: [
      {
        q: 'Is ValueBooks suitable for someone working alone?',
        a: 'Yes. The Solo package is designed for individual professionals and very small businesses.',
      },
      {
        q: 'How many customers can I manage on Solo?',
        a: 'The proposed Solo package supports 10 active customers.',
      },
      {
        q: 'How many invoices can I issue on Solo?',
        a: 'The proposed Solo package supports 5 invoices per month.',
      },
    ],
    assets: [
      {
        assetId: 'freelancers-primary',
        slot: 'primary',
        description: 'Freelancer working in a well-lit home office or independent studio.',
        alt: 'Freelancer working in a well-lit home office',
      },
      {
        assetId: 'freelancers-supporting',
        slot: 'supporting',
        description: 'Professional reviewing client work and invoices.',
        alt: 'Freelancer reviewing client work and invoices',
      },
      {
        assetId: 'freelancers-product',
        slot: 'product',
        description: 'Authentic ValueBooks invoice creation or preview.',
        alt: 'ValueBooks invoice creation or preview with demo information',
      },
    ],
  },
  {
    slug: 'healthcare-practices',
    name: 'Healthcare Practices',
    shortDescription: 'Organize the business finances behind your healthcare practice.',
    seoTitle: 'Accounting for Healthcare Practices | ValueBooks',
    metaDescription:
      'Organize billing records, operating expenses, supplier costs, and financial reports for clinics and healthcare practices with ValueBooks.',
    hero: {
      title: 'Keep your practice finances organized.',
      description:
        'Manage financial records, business expenses, invoices, and purchasing activity with greater clarity, so your team can focus on delivering quality care.',
    },
    introduction: {
      heading: 'Behind every practice is a business to manage.',
      paragraphs: [
        'Clinics, dental practices, therapy centers, and other healthcare providers manage ongoing operational costs, supplier purchases, equipment expenses, and billing activity.',
        'ValueBooks supports the business accounting side of running a healthcare practice. Keep financial records organized and gain clearer visibility into expenditure, receivables, and overall performance.',
      ],
    },
    challenges: [
      {
        title: 'Operational expenses.',
        description: 'Rent, utilities, equipment, and consumables create ongoing costs.',
      },
      {
        title: 'Supplier purchasing.',
        description: 'Medical and nonmedical purchases require organized documentation.',
      },
      {
        title: 'Billing administration.',
        description: 'Financial records and outstanding payments need attention.',
      },
      {
        title: 'Financial reporting.',
        description: 'Practice owners need reliable financial visibility.',
      },
    ],
    benefits: [
      {
        title: 'Organize billing.',
        description: 'Maintain business invoices and expense records.',
      },
      {
        title: 'Track purchasing.',
        description: 'Manage supplier bills and purchase documentation.',
      },
      { title: 'Monitor balances.', description: 'Understand receivables and obligations.' },
      {
        title: 'Review financial performance.',
        description: 'Use statements for business decisions.',
      },
    ],
    features: [
      'Invoicing',
      'Expenses',
      'Vendor management',
      'Bills and purchases',
      'Asset-related accounting records only where supported',
      'Financial reports',
    ],
    workflow: {
      title: 'A focused financial workflow',
      steps: [
        'Record business billing activity.',
        'Capture supplier bills and expenses.',
        'Track relevant payments and obligations.',
        'Review financial reporting.',
      ],
    },
    faqs: [
      {
        q: 'Is ValueBooks an electronic medical records system?',
        a: 'No. ValueBooks is an accounting and business finance platform, not a patient records system.',
      },
      {
        q: 'Can it replace clinical practice management software?',
        a: 'It should not be marketed as replacing clinical management software.',
      },
      {
        q: 'Can I track purchases and operational costs?',
        a: 'Yes, using the available purchasing and expense features.',
      },
    ],
    assets: [
      {
        assetId: 'healthcare-practices-primary',
        slot: 'primary',
        description:
          'Professional clinic reception or administration area, without identifiable patients.',
        alt: 'Professional clinic administration area without patients',
      },
      {
        assetId: 'healthcare-practices-supporting',
        slot: 'supporting',
        description: 'Healthcare administrator reviewing business paperwork.',
        alt: 'Healthcare administrator reviewing business paperwork',
      },
      {
        assetId: 'healthcare-practices-product',
        slot: 'product',
        description: 'Authentic ValueBooks bills or financial reporting screen.',
        alt: 'ValueBooks bills or financial reporting screen with demo information',
      },
    ],
  },
  {
    slug: 'nonprofits-ngos',
    name: 'Nonprofits & NGOs',
    shortDescription: 'Maintain clearer financial records and spending visibility.',
    seoTitle: 'Accounting Software for Nonprofits and NGOs | ValueBooks',
    metaDescription:
      'Organize nonprofit income, spending, financial records, and reporting with ValueBooks. Improve financial visibility for mission-driven organizations.',
    hero: {
      title: 'More clarity for the work that matters.',
      description:
        'Keep income, expenses, financial records, and reporting organized so your nonprofit can make informed decisions and use its resources responsibly.',
    },
    introduction: {
      heading: 'Strong financial organization supports a stronger mission.',
      paragraphs: [
        'Nonprofits and NGOs must pay close attention to how resources are received, allocated, and spent. Administrative expenses, operational activities, purchases, and reporting obligations all require reliable financial records.',
        'ValueBooks provides general accounting tools that help organizations organize transactions, track spending, and prepare financial reports. It can support day-to-day financial administration while leaving specialized grant and donor compliance processes to appropriate systems where required.',
      ],
    },
    challenges: [
      {
        title: 'Tracking income sources.',
        description: 'Financial receipts should be recorded clearly.',
      },
      {
        title: 'Monitoring organizational spending.',
        description: 'Different activities create different costs.',
      },
      {
        title: 'Preparing financial reports.',
        description: 'Stakeholders need understandable financial information.',
      },
      {
        title: 'Maintaining accountable records.',
        description: 'Consistent records support internal review.',
      },
    ],
    benefits: [
      {
        title: 'Organize incoming funds.',
        description: 'Track income and payments in appropriate accounts.',
      },
      { title: 'Track spending.', description: 'Categorize operating expenses.' },
      { title: 'Manage purchasing.', description: 'Keep vendor and bill records accessible.' },
      {
        title: 'Support internal review.',
        description: 'Examine statements and transaction history.',
      },
    ],
    features: [
      'Income recording',
      'Expense management',
      'Chart of accounts',
      'Vendor bills',
      'Financial reporting',
      'Audit history',
    ],
    workflow: {
      title: 'A responsible record-keeping workflow',
      steps: [
        'Record incoming organizational funds using appropriate accounts.',
        'Capture operating expenses and bills.',
        'Reconcile supported financial records.',
        'Prepare financial reports for internal review.',
      ],
    },
    faqs: [
      {
        q: 'Can ValueBooks be used by nonprofit organizations?',
        a: 'Yes, for general business accounting and financial administration.',
      },
      {
        q: 'Does ValueBooks include restricted-fund accounting?',
        a: 'Only advertise restricted-fund features if explicitly implemented and validated.',
      },
      {
        q: 'Does it replace specialist grant management software?',
        a: 'No. Do not claim specialized donor or grant compliance functionality without implementation.',
      },
    ],
    assets: [
      {
        assetId: 'nonprofits-ngos-primary',
        slot: 'primary',
        description: 'Nonprofit staff reviewing programs in an office.',
        alt: 'Nonprofit staff reviewing programs in an office',
      },
      {
        assetId: 'nonprofits-ngos-supporting',
        slot: 'supporting',
        description: 'Organization team reviewing finance records.',
        alt: 'Organization team reviewing finance records',
      },
      {
        assetId: 'nonprofits-ngos-product',
        slot: 'product',
        description: 'Authentic ValueBooks chart of accounts or reports screen.',
        alt: 'ValueBooks chart of accounts or reports screen with demo information',
      },
    ],
  },
  {
    slug: 'wholesale-distribution',
    name: 'Wholesale & Distribution',
    shortDescription: 'Keep sales, supplier costs, and inventory finances connected.',
    seoTitle: 'Accounting for Wholesale and Distribution | ValueBooks',
    metaDescription:
      'Manage wholesale invoices, supplier purchases, inventory records, and financial reporting with ValueBooks.',
    hero: {
      title: 'Stay on top of every order and cost.',
      description:
        'Keep customer invoices, supplier bills, inventory costs, and financial records connected as your wholesale or distribution business grows.',
    },
    introduction: {
      heading: 'Your margins depend on the details.',
      paragraphs: [
        'Wholesale and distribution businesses manage purchasing, stock movement, sales orders, customer balances, and ongoing delivery costs. The financial effect of these activities needs to remain visible even as transaction volumes increase.',
        'ValueBooks helps you organize purchasing and sales records while maintaining a clearer view of business expenses, outstanding payments, and financial performance.',
      ],
    },
    challenges: [
      {
        title: 'High purchasing activity.',
        description: 'Supplier bills and payment obligations add up.',
      },
      {
        title: 'Customer credit balances.',
        description: 'Outstanding invoices require monitoring.',
      },
      {
        title: 'Stock and purchasing costs.',
        description: 'Inventory investment affects available cash.',
      },
      {
        title: 'Operating margins.',
        description: 'Transportation, storage, and other costs influence profitability.',
      },
    ],
    benefits: [
      { title: 'Organize customer sales.', description: 'Maintain invoices and sales records.' },
      { title: 'Track supplier commitments.', description: 'Record purchases and payments due.' },
      {
        title: 'Maintain inventory records.',
        description: 'Use inventory features on eligible plans.',
      },
      {
        title: 'Understand the financial picture.',
        description: 'Review receivables, payables, and profitability.',
      },
    ],
    features: [
      'Sales orders',
      'Invoices',
      'Purchase orders',
      'Supplier bills',
      'Inventory management (eligible plans)',
      'Accounts receivable and payable reports',
    ],
    workflow: {
      title: 'From order to financial visibility',
      steps: [
        'Record a customer sales order.',
        'Issue invoices through the supported order workflow.',
        'Record supplier purchases and expenses.',
        'Review receivables, payables, and performance.',
      ],
    },
    faqs: [
      {
        q: 'Can I manage multiple suppliers?',
        a: 'Yes, subject to the available vendor-management functionality.',
      },
      { q: 'Can I maintain inventory records?', a: 'Yes, on eligible subscriptions.' },
      { q: 'Can I use multiple warehouses?', a: 'Warehouse limits depend on the selected plan.' },
    ],
    assets: [
      {
        assetId: 'wholesale-distribution-primary',
        slot: 'primary',
        description: 'Well-organized warehouse or distribution center.',
        alt: 'Well-organized warehouse and distribution center',
      },
      {
        assetId: 'wholesale-distribution-supporting',
        slot: 'supporting',
        description: 'Operations worker reviewing inventory records.',
        alt: 'Operations worker reviewing inventory records',
      },
      {
        assetId: 'wholesale-distribution-product',
        slot: 'product',
        description: 'Authentic ValueBooks inventory or purchasing screen.',
        alt: 'ValueBooks inventory or purchasing screen with demo information',
      },
    ],
  },
  {
    slug: 'education-training',
    name: 'Education & Training',
    shortDescription: 'Organize billing and expenses for education businesses.',
    seoTitle: 'Accounting Software for Education and Training Businesses | ValueBooks',
    metaDescription:
      'Organize tuition-related invoices, operating expenses, purchasing, and financial reports for training centers and education businesses.',
    hero: {
      title: 'Clearer finances for learning organizations.',
      description:
        'Keep billing, expenses, purchases, and financial reporting organized so your education or training business can focus on supporting learners.',
    },
    introduction: {
      heading: 'Good administration supports better learning.',
      paragraphs: [
        'Training centers, academies, private education providers, and professional learning businesses handle income, operating costs, supplier bills, and recurring expenses.',
        'ValueBooks helps organize the financial side of these activities. Maintain clear accounting records and review business performance without depending on disconnected spreadsheets.',
      ],
    },
    challenges: [
      {
        title: 'Managing billing.',
        description: 'Different services or programs may require different invoices.',
      },
      {
        title: 'Monitoring payments.',
        description: 'Outstanding customer balances require follow-up.',
      },
      {
        title: 'Tracking operating expenses.',
        description: 'Facilities, materials, and administration generate costs.',
      },
      {
        title: 'Understanding financial sustainability.',
        description: 'Accurate reporting supports planning.',
      },
    ],
    benefits: [
      { title: 'Organize invoices.', description: 'Issue records for programs and services.' },
      { title: 'Track payments.', description: 'Maintain visibility into outstanding balances.' },
      { title: 'Manage operating costs.', description: 'Record purchasing and expenses.' },
      { title: 'Improve planning.', description: 'Review income and financial statements.' },
    ],
    features: [
      'Customer records',
      'Invoices',
      'Recurring invoicing (eligible plans)',
      'Expense tracking',
      'Purchase management',
      'Financial reporting',
    ],
    workflow: {
      title: 'An organized billing and expense flow',
      steps: [
        'Create a customer or organization billing record.',
        'Issue invoices for training services.',
        'Track payments and operating expenses.',
        'Review financial reports.',
      ],
    },
    faqs: [
      { q: 'Can ValueBooks create invoices for training services?', a: 'Yes.' },
      {
        q: 'Can it track outstanding payments?',
        a: 'Yes, through invoice and payment tracking features.',
      },
      {
        q: 'Is it a student information system?',
        a: 'No. Do not present ValueBooks as a full student management platform.',
      },
    ],
    assets: [
      {
        assetId: 'education-training-primary',
        slot: 'primary',
        description: 'Training center or education administration.',
        alt: 'Training center administration space',
      },
      {
        assetId: 'education-training-supporting',
        slot: 'supporting',
        description: 'Program manager reviewing business budgets.',
        alt: 'Program manager reviewing business budgets',
      },
      {
        assetId: 'education-training-product',
        slot: 'product',
        description: 'Authentic ValueBooks invoicing or receivables screen.',
        alt: 'ValueBooks invoicing or receivables screen with demo information',
      },
    ],
  },
  {
    slug: 'real-estate-property',
    name: 'Real Estate & Property Services',
    shortDescription: 'Manage property-service billing, expenses, and financial records.',
    seoTitle: 'Accounting for Real Estate and Property Services | ValueBooks',
    metaDescription:
      'Track property-service invoices, operating expenses, purchasing, and business financial reporting with ValueBooks.',
    hero: {
      title: 'Keep your property business finances clear.',
      description:
        'Organize business invoices, property-related expenses, supplier costs, and financial records in one place. ValueBooks helps property service businesses understand their financial position.',
    },
    introduction: {
      heading: 'Property businesses need more than scattered receipts.',
      paragraphs: [
        'Real estate agencies, property service providers, and property maintenance businesses handle client billing, supplier expenses, contractor costs, and operational spending.',
        'ValueBooks helps you keep these financial records organized and review how income and expenses affect your overall business performance.',
      ],
    },
    challenges: [
      {
        title: 'Multiple income sources.',
        description: 'Service and customer billing need consistent records.',
      },
      {
        title: 'Property-related expenses.',
        description: 'Repairs, maintenance, and contractor costs require tracking.',
      },
      { title: 'Supplier obligations.', description: 'Bills and payments need clear visibility.' },
      {
        title: 'Financial performance.',
        description: 'Business owners need dependable financial reports.',
      },
    ],
    benefits: [
      { title: 'Organize invoicing.', description: 'Keep customer and service billing clear.' },
      { title: 'Record expenses.', description: 'Categorize maintenance and operational costs.' },
      { title: 'Manage suppliers.', description: 'Track bills and outstanding obligations.' },
      {
        title: 'Review financial performance.',
        description: 'Access income, expense, and profitability reports.',
      },
    ],
    features: [
      'Customer management',
      'Invoicing',
      'Expenses',
      'Supplier bills',
      'Project expense tracking where relevant and plan-eligible',
      'Financial statements',
    ],
    workflow: {
      title: 'A clearer property-service workflow',
      steps: [
        'Record client invoices.',
        'Capture maintenance or operational expenses.',
        'Manage supplier obligations.',
        'Review financial reporting.',
      ],
    },
    faqs: [
      {
        q: 'Can I track maintenance expenses?',
        a: 'Yes. Expenses can be recorded and categorized appropriately.',
      },
      { q: 'Can I invoice clients for property services?', a: 'Yes.' },
      {
        q: 'Does ValueBooks include tenant portals or lease management?',
        a: 'Do not advertise these capabilities unless implemented.',
      },
    ],
    assets: [
      {
        assetId: 'real-estate-property-primary',
        slot: 'primary',
        description: 'Property professional reviewing documents in a modern office.',
        alt: 'Property professional reviewing documents in a modern office',
      },
      {
        assetId: 'real-estate-property-supporting',
        slot: 'supporting',
        description: 'Building exterior or property inspection.',
        alt: 'Property inspection at a commercial building',
      },
      {
        assetId: 'real-estate-property-product',
        slot: 'product',
        description: 'Authentic ValueBooks expenses or projects screen.',
        alt: 'ValueBooks expenses or projects screen with demo information',
      },
    ],
  },
];

export const industries = registry;
export const industryBySlug = Object.fromEntries(
  registry.map((industry) => [industry.slug, industry]),
) as Record<string, Industry>;

export const industryGroups = [
  {
    label: 'Commerce & Hospitality',
    slugs: ['retail', 'ecommerce', 'restaurants-hospitality', 'wholesale-distribution'],
  },
  {
    label: 'Services & Projects',
    slugs: ['freelancers', 'agencies-consultants', 'professional-services', 'construction-trades'],
  },
  {
    label: 'Organizations & Specialized Businesses',
    slugs: [
      'healthcare-practices',
      'nonprofits-ngos',
      'education-training',
      'real-estate-property',
    ],
  },
] as const;
