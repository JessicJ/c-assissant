import { MahBusinessContractError } from './mah-business-contract.js';
import type { MahPublicRead } from './mah-business-public-result.js';

/** Public preview admits a submission, without certifying execution or results. */
export async function assertMahReadOnlySubmission(projectRoot: string, run: MahPublicRead, signal?: AbortSignal): Promise<void> {
  const response = await run(['task', 'submit', '--cwd', projectRoot, '--no-write', '--preview',
    '--description', 'Preview one read-only Landi planning request.', '--format', 'json'], signal);
  let preview: unknown;
  try { preview = JSON.parse(response.stdout); } catch { throw new MahBusinessContractError('mah_business_submission_contract_unverified'); }
  const value = preview as Record<string, unknown> | null;
  if (response.code !== 0 || !value || typeof value !== 'object' || Array.isArray(value)
    || value.ok !== true || value.project_root !== projectRoot || value.mode !== 'read_only'
    || !Array.isArray(value.will_not_execute) || !value.will_not_execute.includes('write')) {
    throw new MahBusinessContractError('mah_business_submission_contract_unverified');
  }
}
