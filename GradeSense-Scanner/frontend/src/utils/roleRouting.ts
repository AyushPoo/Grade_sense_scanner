export type MobileUserRole = 'teacher' | 'student' | 'admin' | 'platform' | string | null | undefined;

export type MobileRouteGroup = '(tabs)' | '(student)' | '(admin)';

export function routeGroupForRole(role: MobileUserRole): MobileRouteGroup {
  if (role === 'student') return '(student)';
  if (role === 'admin' || role === 'platform') return '(admin)';
  return '(tabs)';
}

export function roleHomeRoute(role: MobileUserRole): string {
  const group = routeGroupForRole(role);
  if (group === '(student)') return '/(student)/dashboard';
  if (group === '(admin)') return '/(admin)/dashboard';
  return '/(tabs)/home';
}

export function shouldRedirectRoleGroup(role: MobileUserRole, currentGroup?: string): boolean {
  if (!currentGroup || currentGroup === '(auth)') return false;
  const expectedGroup = routeGroupForRole(role);
  return ['(tabs)', '(student)', '(admin)'].includes(currentGroup) && currentGroup !== expectedGroup;
}
