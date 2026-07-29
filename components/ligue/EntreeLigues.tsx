"use client";

// L'écran de `/ligues` : créer une ligue, ou entrer dans celle d'un pote.
//
// Une route à part, et pas un bouton dans l'app. Le challenge d'origine tourne
// jusqu'au 31 août avec ses neuf joueurs : leur poser « Créer ma ligue » sous
// les yeux en plein milieu, c'est leur proposer de partir ailleurs. L'entrée
// est l'adresse, elle se partage à ceux que ça concerne.
//
// Après la phase 5, quand tout le monde sera en ligues, elle aura sa place
// dans l'interface.

import { useState } from "react";
import type { Ligue } from "@/lib/ligue";
import AccueilLigue from "./AccueilLigue";
import CreerLigue from "./CreerLigue";

export default function EntreeLigues() {
  const [creation, setCreation] = useState(false);

  // On ne « rentre » pas ici : on va à l'adresse de la ligue. Une navigation
  // pleine, pas un changement d'état — c'est elle qui fait basculer le client
  // Supabase sur le bon schéma (voir `lib/supabase.ts`).
  const va = (l: Ligue) => {
    window.location.href = `/l/${l.slug}`;
  };

  if (creation) {
    return <CreerLigue onCreee={va} onRetour={() => setCreation(false)} />;
  }
  return <AccueilLigue onTrouvee={va} onCreer={() => setCreation(true)} />;
}
