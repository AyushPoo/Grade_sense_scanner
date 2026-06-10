function hashScope(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export const syncKeys = {
  scope(token?: string | null) {
    return token ? hashScope(token) : 'signed-out';
  },
  teacherOverview(token?: string | null) {
    return `teacher-overview:${this.scope(token)}`;
  },
  managePerformance(token?: string | null) {
    return `manage-performance:${this.scope(token)}`;
  },
  managedExams(token?: string | null) {
    return `managed-exams:${this.scope(token)}`;
  },
  reviewReadyExams(token?: string | null) {
    return `review-ready-exams:${this.scope(token)}`;
  },
  batches(token?: string | null) {
    return `batches:${this.scope(token)}`;
  },
  batchExams(token: string | null | undefined, batchId: string) {
    return `batch-exams:${this.scope(token)}:${batchId}`;
  },
  batchStudents(token: string | null | undefined, batchId: string) {
    return `batch-students:${this.scope(token)}:${batchId}`;
  },
};
