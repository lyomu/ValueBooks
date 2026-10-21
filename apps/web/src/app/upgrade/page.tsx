import type { Metadata } from 'next';

import { PlanPicker } from '../../components/plan-picker';

export const metadata: Metadata = { title: 'Choose a plan | ValueBooks' };

export default function UpgradePage() {
  return <PlanPicker mode="upgrade" />;
}
