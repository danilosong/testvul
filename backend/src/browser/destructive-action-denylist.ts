// The absolute Destructive Action Denylist — checked by label text,
// case/accent-insensitively. Every one of these is never auto-executed by
// this engine in any scan mode, including Advanced. Portuguese
// equivalents are listed alongside the English terms, not as a separate
// list, so a single check covers both.
export const DESTRUCTIVE_ACTION_DENYLIST = [
  "delete",
  "remove",
  "destroy",
  "cancel account",
  "withdraw",
  "payment",
  "purchase",
  "pay",
  "refund",
  "prize",
  "winner",
  "transfer",
  "send money",
  "close account",
  "reset database",
  // Portuguese equivalents
  "excluir",
  "remover",
  "destruir",
  "cancelar conta",
  "sacar",
  "saque",
  "pagamento",
  "compra",
  "pagar",
  "reembolso",
  "premio",
  "vencedor",
  "transferir",
  "enviar dinheiro",
  "encerrar conta",
  "resetar banco de dados",
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // strip accents so "prêmio"/"premio" match the same way
}

const NORMALIZED_DENYLIST = DESTRUCTIVE_ACTION_DENYLIST.map(normalize);

/** True if `label` matches any entry in the absolute Destructive Action Denylist. */
export function isDestructiveAction(label: string): boolean {
  const normalized = normalize(label);
  return NORMALIZED_DENYLIST.some((keyword) => normalized.includes(keyword));
}

export class DestructiveActionError extends Error {
  constructor(public readonly label: string) {
    super(`Action "${label}" matches the absolute Destructive Action Denylist and is never auto-executed, regardless of scan mode`);
    this.name = "DestructiveActionError";
  }
}

/**
 * The mandatory guard every action-execution path — the Discovery Stage's
 * dry-run capture and the eventual Security Test Stage's real-mutation
 * function (Section 12.20) alike — must call before ever executing or
 * dry-running an action for real. There is no scan-mode parameter this
 * function accepts or consults, including Advanced: the denylist is
 * absolute, not mode-conditional.
 */
export function assertNotDestructiveAction(label: string): void {
  if (isDestructiveAction(label)) {
    throw new DestructiveActionError(label);
  }
}
