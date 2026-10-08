import type { Metadata } from 'next';

import { WorkflowRulesPage } from '../../../components/workflow-rules-workbench';

export const metadata: Metadata = { title: 'Workflow rules | ValueBooks' };

export default function WorkflowRulesSettingsPage() {
  return <WorkflowRulesPage />;
}
