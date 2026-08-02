"use client";

// 😴 Le bandeau du jour off, en tête de TodayScreen.
//
// Il n'a ni ✕ ni tap : contrairement à l'événement du jour, il n'y a rien
// à découvrir derrière et rien à écarter. C'est une information d'état —
// « aujourd'hui ne compte pas contre toi » — et elle doit rester lisible
// toute la journée, y compris à 23h par celui qui hésite à se lever.
//
// Il ne verrouille RIEN. Les trois cartes restent ouvertes, la séance se
// lance normalement, la coche marque ses points et la journée reste un
// vrai 3/3. Un jour off est une permission, pas une fermeture — d'où le
// « si tu y vas quand même » en toutes lettres plutôt qu'un ton d'excuse.
//
// Neutre plutôt que teinté à la couleur du joueur : le jour off est le
// même pour tout le monde, c'est le seul élément de l'écran qui ne parle
// de personne en particulier.

export default function JourOffBanner() {
  return (
    <div
      role="status"
      className="mt-4 flex items-center gap-3 rounded-2xl bg-surface px-3 py-2.5"
      style={{ boxShadow: "inset 0 0 0 1px var(--color-line)" }}
    >
      <span aria-hidden className="shrink-0 text-xl">
        😴
      </span>
      <p className="min-w-0 text-sm">
        <span className="font-bold">Jour off</span>
        <span className="text-muted">
          {" — "}ta série tient sans rien cocher. Si tu y vas quand même, tout
          compte normalement.
        </span>
      </p>
    </div>
  );
}
