/* global __dirname */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');

function loadTsModule(relativePath, moduleCache = new Map()) {
  const filename = path.join(__dirname, '..', relativePath);
  if (moduleCache.has(filename)) {
    return moduleCache.get(filename).exports;
  }

  const source = fs.readFileSync(filename, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;

  const module = { exports: {} };
  moduleCache.set(filename, module);
  const localRequire = (specifier) => {
    if (specifier.startsWith('.')) {
      const resolved = path.join(path.dirname(relativePath), specifier);
      const normalized = resolved.replace(/\\/g, '/');
      const tsRelative = normalized.endsWith('.ts') ? normalized : `${normalized}.ts`;
      return loadTsModule(tsRelative, moduleCache);
    }
    return require(specifier);
  };
  const context = vm.createContext({
    exports: module.exports,
    module,
    process: { env: {} },
    require: localRequire,
  });
  vm.runInContext(transpiled, context, { filename });
  return module.exports;
}

test('roleHomeRoute sends each account type to its own mobile shell', () => {
  const { roleHomeRoute, routeGroupForRole, shouldRedirectRoleGroup } = loadTsModule('src/utils/roleRouting.ts');

  assert.equal(roleHomeRoute('teacher'), '/(tabs)/home');
  assert.equal(roleHomeRoute('student'), '/(student)/dashboard');
  assert.equal(roleHomeRoute('admin'), '/(admin)/dashboard');
  assert.equal(roleHomeRoute(undefined), '/(tabs)/home');

  assert.equal(routeGroupForRole('student'), '(student)');
  assert.equal(shouldRedirectRoleGroup('admin', '(student)'), true);
  assert.equal(shouldRedirectRoleGroup('admin', '(admin)'), false);
});

test('student portal normalizers preserve published-result visibility and stable empty defaults', () => {
  const { normalizeStudentDashboard, normalizeStudentSubmissions } = loadTsModule('src/utils/studentPortalData.ts');

  const dashboard = normalizeStudentDashboard({
    stats: { totalExams: '2', avgPercentage: 77.64, rank: 'Top 10', improvement: '-4.2' },
    recentResults: [{ submissionId: 'sub_1', examName: 'Maths', percentage: '81.2', score: '32/40' }],
    recommendations: ['Review Q3'],
  });
  assert.equal(dashboard.stats.totalExams, 2);
  assert.equal(dashboard.stats.avgPercentage, 77.6);
  assert.equal(dashboard.stats.improvement, -4.2);
  assert.equal(dashboard.recentResults[0].percentage, 81.2);
  assert.equal(dashboard.subjectPerformance.length, 0);
  assert.equal(dashboard.weakAreas.length, 0);

  const submissions = normalizeStudentSubmissions([
    { id: 'sub_1', examId: 'exam_1', totalScore: '32', totalMarks: 40, percentage: 80, status: 'published' },
    { id: '', examId: 'exam_2' },
  ]);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].totalScore, 32);
});

test('admin portal normalizers keep teacher limits and pending invites display-ready', () => {
  const { normalizeAdminTeachers, normalizeTeacherInvites } = loadTsModule('src/utils/adminPortalData.ts');

  const teachers = normalizeAdminTeachers([
    { id: 'usr_1', name: '  Priya  ', email: 'p@example.com', role: 'teacher', accountStatus: 'active', paperLimit: '250' },
    { id: 'usr_2', name: 'Student', email: 's@example.com', role: 'student' },
  ]);
  assert.equal(teachers.length, 1);
  assert.equal(teachers[0].name, 'Priya');
  assert.equal(teachers[0].paperLimit, 250);

  const invites = normalizeTeacherInvites([
    { id: 'tiv_1', email: 'new@example.com', name: 'New Teacher', status: 'pending', createdAt: '2026-06-03T00:00:00Z' },
  ]);
  assert.equal(invites[0].status, 'pending');
  assert.equal(invites[0].email, 'new@example.com');
});

test('portal API endpoint maps stay behind the scanner backend gateway', () => {
  const { studentPortalEndpoints } = loadTsModule('src/api/studentPortal.ts');
  const { adminPortalEndpoints } = loadTsModule('src/api/adminPortal.ts');

  assert.equal(studentPortalEndpoints.dashboard, '/api/v1/student/dashboard');
  assert.equal(studentPortalEndpoints.submissions, '/api/v1/student/submissions');
  assert.equal(adminPortalEndpoints.teachers, '/api/v1/admin/teachers');
  assert.equal(adminPortalEndpoints.feedback, '/api/v1/admin/feedback');
});

test('scanner accessory link points teachers to the configured paper mount', () => {
  const { PAPER_SCAN_MOUNT_LINK } = loadTsModule('src/constants/scannerAccessories.ts');

  assert.equal(PAPER_SCAN_MOUNT_LINK.label, 'Paper scanning mount');
  assert.equal(PAPER_SCAN_MOUNT_LINK.url, 'https://www.meesho.com/lazy-stand-holder-metal-based/p/93gzz1');
});
