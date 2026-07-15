export function safeMigrationFailureMessage(_error?: unknown): string {
  void _error;
  return "Database migration failed safely; no credential was printed.";
}
