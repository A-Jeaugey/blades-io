import { t } from "../i18n";

// Modales du jeu (tâche 3.9), à la place des boîtes du navigateur (alert,
// confirm) : celles-ci bloquaient la page (rendu et réseau à l'arrêt) et
// sortaient du style du jeu. Une seule modale à la fois, les suivantes
// attendent leur tour. Entrée valide, Échap annule ; les touches ne vont
// pas au jeu derrière.

interface DialogButton {
  label: string;
  value: boolean;
  primary?: boolean;
}

let root: HTMLElement | null = null;
let queue: Promise<unknown> = Promise.resolve();

function ensureRoot(): HTMLElement {
  if (root) return root;
  root = document.createElement("div");
  root.id = "dialog";
  root.className = "dialog hidden";
  root.setAttribute("role", "alertdialog");
  root.setAttribute("aria-modal", "true");
  root.innerHTML = `<div class="dialog-card"><p class="dialog-msg" id="dialog-msg"></p><div class="dialog-actions"></div></div>`;
  root.setAttribute("aria-describedby", "dialog-msg");
  document.body.appendChild(root);
  return root;
}

function open(message: string, buttons: DialogButton[]): Promise<boolean> {
  const run = () =>
    new Promise<boolean>((resolve) => {
      const el = ensureRoot();
      (el.querySelector(".dialog-msg") as HTMLElement).textContent = message;
      const actions = el.querySelector(".dialog-actions") as HTMLElement;
      actions.innerHTML = "";
      const previous = document.activeElement as HTMLElement | null;
      const close = (value: boolean) => {
        el.classList.add("hidden");
        document.removeEventListener("keydown", onKey, true);
        previous?.focus?.();
        resolve(value);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== "Escape" && e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        close(e.key === "Enter" ? buttons.some((b) => b.primary && b.value) : false);
      };
      for (const b of buttons) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = b.primary ? "dialog-btn primary" : "dialog-btn";
        btn.textContent = b.label;
        btn.addEventListener("click", () => close(b.value));
        actions.appendChild(btn);
      }
      document.addEventListener("keydown", onKey, true);
      el.classList.remove("hidden");
      (actions.querySelector(".primary") as HTMLButtonElement | null)?.focus();
    });
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

export function showAlert(message: string): Promise<void> {
  return open(message, [{ label: t("dialog.ok"), value: true, primary: true }]).then(() => undefined);
}

// Vrai si le joueur confirme.
export function showConfirm(message: string, confirmLabel: string, cancelLabel: string): Promise<boolean> {
  return open(message, [
    { label: cancelLabel, value: false },
    { label: confirmLabel, value: true, primary: true },
  ]);
}
