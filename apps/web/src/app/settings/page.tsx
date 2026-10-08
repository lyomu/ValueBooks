import type { Metadata } from 'next';

import { SettingsIndex } from '../../components/settings-index';

export const metadata: Metadata = { title: 'All settings | ValueBooks' };

export default function SettingsIndexPage() {
  return <SettingsIndex />;
}
