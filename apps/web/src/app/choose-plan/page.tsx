import type { Metadata } from 'next';

import { PlanPicker } from '../../components/plan-picker';

export const metadata: Metadata = { title: 'Choose your plan | ValueBooks' };

export default function ChoosePlanPage() {
  return <PlanPicker mode="signup" />;
}
