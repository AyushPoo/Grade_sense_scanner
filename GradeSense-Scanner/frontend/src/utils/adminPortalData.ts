export interface AdminTeacher {
  id: string;
  name: string;
  email: string;
  accountStatus: string;
  paperLimit: number;
  createdAt: string | null;
}

export interface TeacherInvite {
  id: string;
  email: string;
  name: string;
  status: string;
  createdAt: string | null;
}

export interface AdminProductFeedback {
  id: string;
  type: string;
  status: string;
  title: string;
  body: string;
  userLabel: string;
  createdAt: string | null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function readNullableString(value: unknown): string | null {
  const text = readString(value);
  return text || null;
}

function readNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function normalizeAdminTeachers(rows: unknown): AdminTeacher[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(row => {
    const item = objectValue(row);
    if (readString(item.role) !== 'teacher') return null;
    const id = readString(item.id);
    if (!id) return null;
    return {
      id,
      name: readString(item.name, 'Teacher') || 'Teacher',
      email: readString(item.email),
      accountStatus: readString(item.accountStatus ?? item.account_status, 'active') || 'active',
      paperLimit: readNumber(item.paperLimit ?? item.paper_limit, 100),
      createdAt: readNullableString(item.createdAt ?? item.created_at),
    };
  }).filter((item): item is AdminTeacher => item !== null);
}

export function normalizeTeacherInvites(rows: unknown): TeacherInvite[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(row => {
    const item = objectValue(row);
    const id = readString(item.id);
    if (!id) return null;
    return {
      id,
      email: readString(item.email),
      name: readString(item.name, 'Teacher') || 'Teacher',
      status: readString(item.status, 'pending') || 'pending',
      createdAt: readNullableString(item.createdAt ?? item.created_at),
    };
  }).filter((item): item is TeacherInvite => item !== null);
}

export function normalizeAdminProductFeedback(rows: unknown): AdminProductFeedback[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(row => {
    const item = objectValue(row);
    const id = readString(item.id);
    if (!id) return null;
    const data = objectValue(item.data);
    const user = objectValue(item.user);
    const title = readString(data.title ?? data.subject ?? item.type, 'Feedback');
    const body = readString(data.body ?? data.message ?? data.description ?? data.text, 'No details supplied.');
    return {
      id,
      type: readString(item.type, 'feedback') || 'feedback',
      status: readString(item.status, 'pending') || 'pending',
      title,
      body,
      userLabel: [readString(user.name), readString(user.email)].filter(Boolean).join(' - ') || 'Unknown user',
      createdAt: readNullableString(item.createdAt ?? item.created_at),
    };
  }).filter((item): item is AdminProductFeedback => item !== null);
}
