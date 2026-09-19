import type { Metadata } from 'next';

import { PlatformUsers } from '../../../components/platform-users';

export const metadata: Metadata = { title: 'Users | ValueBooks platform' };

export default function PlatformUsersRoute() {
  return <PlatformUsers />;
}
