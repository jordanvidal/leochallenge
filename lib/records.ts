// Le record de volume : la seule mécanique de l'appli où un joueur se
// mesure à lui-même. Tout le reste — le rang, le duel, le premier du jour,
// la semaine gagnée — est relatif aux autres, et n'a rien à dire à celui
// qui est dernier. Ici, battre son propre chiffre suffit.
//
// Aucun point n'est en jeu : c'est une carte de fil, pas un bonus. Rien à
// optimiser, donc personne ne déclarera 400 pompes pour empocher quoi que
// ce soit.
//
// Logique pure, sans base : /api/moments lui passe les déclarations, elle
// rend les cartes à insérer. C'est ce qui la rend testable (tests/).

/** Le volume d'une journée = les répétitions déclarées EN PLUS des 300 du
    contrat. Seuls les trois exos du contrat comptent : la course, le
    gainage, la corde et les 10 000 pas sont des à-côtés. Une échelle hors
    de cette liste (burpees, fentes) n'entre donc pas dans le calcul.

    On reconnaît un exo du contrat par `bonus_catalog.ladder`, jamais par
    une liste de clés en dur : un palier peut s'ajouter au catalogue, la
    colonne `ladder` est la seule définition qui ne se périme pas. */
export const ECHELLES_CONTRAT: readonly string[] = ["pompes", "abdos", "squats"];

/** Répétitions par palier. Le catalogue ne stocke que les points, jamais
    les répétitions : cette table est la seule définition côté code, et elle
    peut donc se désynchroniser du catalogue. D'où le garde-fou de
    `volumeRecords()` — un palier ajouté à l'une des trois échelles et
    oublié ici suspend le calcul plutôt que de compter un total partiel.

    Les paliers d'une même échelle se cumulent depuis la migration 22 :
    `pompes_50` + `pompes_100` le même jour = 150 répétitions. */
export const REPS_PAR_PALIER: Record<string, number> = {
  pompes_50: 50,
  pompes_100: 100,
  abdos_100: 100,
  abdos_200: 200,
  squats_100: 100,
  squats_200: 200,
};

/** Mesuré en répétitions et pas en points, et ce n'est pas un détail : le
    tarif d'un bonus bouge d'une saison à l'autre (une course à 20 points
    ferait « battre son record » à qui n'a pas fait une pompe de plus),
    alors que 350 répétitions veulent dire la même chose en S1, en S3 et
    l'an prochain. */
export type VolumeClaim = {
  player_id: string;
  day: string;
  bonus_key: string;
};

export type VolumeRecord = {
  player_id: string;
  day: string;
  reps: number; // le nouveau record
  before: number; // l'ancien, celui qui vient de tomber
};

export type VolumeOutcome = {
  /** Les records tombés le jour demandé. */
  records: VolumeRecord[];
  /** Joueurs dont le calcul a été abandonné : un palier d'une des trois
      échelles manque à `REPS_PAR_PALIER`. On ne sait plus rien d'eux, donc
      on n'annonce ni ne retire aucune carte les concernant. */
  abandoned: Set<string>;
};

/** La clé de dédup d'une carte de volume. Le préfixe sépare les deux
    familles de `kind: "record"` : le record de série se dédup sur une date
    nue (son jour de départ d'îlot), celui de volume sur `vol:<jour>`. Une
    seule fonction pour l'insertion et pour la suppression : les deux ne
    peuvent pas diverger. */
export function volumeDedupeKey(day: string): string {
  return `vol:${day}`;
}

/**
 * Les records de volume tombés `today`, tous joueurs confondus.
 *
 * La carte tombe quand le volume du jour dépasse STRICTEMENT le meilleur
 * volume de tous les jours précédents de ce joueur. Le record est à vie :
 * il ne se réinitialise pas à chaque saison, c'est ce qui le rend rare.
 *
 * @param claims    toutes les déclarations connues, tous jours, tous joueurs
 * @param ladderOf  clé de bonus -> `bonus_catalog.ladder`
 * @param today     le jour évalué (jour civil Paris)
 */
export function volumeRecords(
  claims: VolumeClaim[],
  ladderOf: ReadonlyMap<string, string | null>,
  today: string,
): VolumeOutcome {
  const abandoned = new Set<string>();
  // joueur -> jour -> répétitions du jour
  const volumes = new Map<string, Map<string, number>>();

  for (const c of claims) {
    const ladder = ladderOf.get(c.bonus_key);
    if (!ladder || !ECHELLES_CONTRAT.includes(ladder)) continue;

    const reps = REPS_PAR_PALIER[c.bonus_key];
    if (reps === undefined) {
      // Palier d'une des trois échelles absent de la table : tout total le
      // concernant est partiel. On abandonne le joueur en entier, y compris
      // ses jours passés — ce sont eux la référence, et un passé
      // sous-évalué ferait tomber une carte pour un record qui n'en est
      // pas un. Un record sous-évalué qui s'annonce quand même est pire
      // qu'une carte manquante.
      abandoned.add(c.player_id);
      continue;
    }

    const days = volumes.get(c.player_id) ?? new Map<string, number>();
    days.set(c.day, (days.get(c.day) ?? 0) + reps);
    volumes.set(c.player_id, days);
  }

  const records: VolumeRecord[] = [];
  for (const [playerId, days] of volumes) {
    if (abandoned.has(playerId)) continue;

    // Journée sans déclaration sur les trois exos : volume 0, jamais un
    // record — il faudrait un passé négatif.
    const reps = days.get(today) ?? 0;

    let before = 0;
    let hasPast = false;
    for (const [day, v] of days) {
      if (day >= today) continue;
      hasPast = true;
      if (v > before) before = v;
    }

    // Deux gardes, dans cet ordre : il faut un record antérieur à dépasser
    // (la première déclaration de la vie d'un joueur n'en est pas un), et
    // égaler n'est pas battre (comparaison stricte).
    if (hasPast && reps > before) {
      records.push({ player_id: playerId, day: today, reps, before });
    }
  }

  // Ordre stable : l'itération d'une Map suit l'ordre d'insertion, donc
  // celui des lignes rendues par la base. On ne s'en remet pas à ça.
  records.sort((a, b) => (a.player_id < b.player_id ? -1 : 1));
  return { records, abandoned };
}
