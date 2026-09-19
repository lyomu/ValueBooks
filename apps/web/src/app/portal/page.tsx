import type { Metadata } from 'next';
import { PortalWorkbench } from '../../components/portal-workbench';
export const metadata: Metadata = { title: 'Customer portal | ValueBooks' };
export default function PortalPage() {
  return <PortalWorkbench />;
}
