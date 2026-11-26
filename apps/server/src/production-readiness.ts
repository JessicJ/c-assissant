// Local installation/login diagnostics never prove a public execution contract.
// No affirmative production gate exists until verified MAH public APIs are wired.
export function productionReadiness() {
  return {
    status: "blocked" as const,
    code: "public_mah_contract_unverified" as const,
    conversation: false, generation: false, revision: false,
    unattendedEmail: false, hosting: false
  };
}
