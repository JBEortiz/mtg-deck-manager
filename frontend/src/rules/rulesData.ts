export type RulesStackUsage = "Yes" | "No" | "Sometimes";

export type RulesEntry = {
  id: string;
  name: string;
  aliases: string[];
  shortAnswer: string;
  usesStack: RulesStackUsage;
  why: string;
  importantNuance: string;
  exampleQuestion: string;
  exampleAnswer: string;
};

export const RULES_ENTRIES: RulesEntry[] = [
  {
    id: "ninjutsu",
    name: "Ninjutsu",
    aliases: ["ninjutsu", "unblocked attacker", "return an unblocked attacker", "ninja"],
    shortAnswer: "Usually yes, ninjutsu still works if the unblocked attacker is still legal when the ability resolves.",
    usesStack: "Yes",
    why: "Ninjutsu is an activated ability. Players can respond before it resolves.",
    importantNuance: "If your opponent removes the creature you planned to return, you cannot pay that return cost on resolution and ninjutsu fails.",
    exampleQuestion: "With ninjutsu, if they Lightning Bolt in response, does it still happen?",
    exampleAnswer: "If the attacker survives and remains unblocked, ninjutsu can still resolve. If that creature is gone, ninjutsu does not put the Ninja in."
  },
  {
    id: "ward",
    name: "Ward",
    aliases: ["ward", "counter unless", "target spell cost", "pay ward"],
    shortAnswer: "Ward triggers when an opponent targets the permanent, and they must pay or their spell/ability is countered.",
    usesStack: "Yes",
    why: "Ward is a triggered ability that goes on the stack after targeting happens.",
    importantNuance: "The spell is already cast and targeted. Ward does not stop targeting up front; it taxes/counters afterward.",
    exampleQuestion: "Does ward use the stack?",
    exampleAnswer: "Yes. Ward trigger goes on the stack and resolves separately from the original spell or ability."
  },
  {
    id: "hexproof",
    name: "Hexproof",
    aliases: ["hexproof", "can t be targeted", "cant be targeted", "targeted removal", "board wipe"],
    shortAnswer: "Hexproof stops opponents from targeting, but it does not stop non-targeting effects like most board wipes.",
    usesStack: "No",
    why: "Hexproof is a static ability that changes what is legal to target.",
    importantNuance: "If the effect says " + '"each creature"' + " or otherwise does not target, hexproof does nothing.",
    exampleQuestion: "Does hexproof stop board wipes?",
    exampleAnswer: "Usually no. Wrath-style effects that do not target still destroy hexproof creatures."
  },
  {
    id: "shroud",
    name: "Shroud",
    aliases: ["shroud", "can t be the target", "cant be the target", "target by anyone"],
    shortAnswer: "Shroud means no player can target that permanent, including its controller.",
    usesStack: "No",
    why: "Shroud is a static targeting restriction.",
    importantNuance: "Unlike hexproof, you also cannot target your own shrouded creature with buffs or equip abilities.",
    exampleQuestion: "Can I target my own creature with shroud?",
    exampleAnswer: "No. Shroud blocks all targeting from every player."
  },
  {
    id: "indestructible",
    name: "Indestructible",
    aliases: ["indestructible", "destroy effect", "damage won t destroy", "damage wont destroy"],
    shortAnswer: "Indestructible prevents destruction from lethal damage and " + '"destroy"' + " effects.",
    usesStack: "No",
    why: "It is a static quality that changes what can destroy the permanent.",
    importantNuance: "It can still be exiled, bounced, sacrificed, or get -X/-X until toughness is 0 or less.",
    exampleQuestion: "Does indestructible survive destroy all creatures?",
    exampleAnswer: "Yes, if the effect destroys. But exile/sacrifice-based sweepers still remove it."
  },
  {
    id: "deathtouch",
    name: "Deathtouch",
    aliases: ["deathtouch", "trample deathtouch", "one damage is lethal", "combat damage lethal"],
    shortAnswer: "Any nonzero combat damage from a source with deathtouch is considered lethal for creatures it damages.",
    usesStack: "No",
    why: "Deathtouch modifies combat damage results; it is not a trigger.",
    importantNuance: "With trample, assigning only 1 damage to each blocker can be enough before assigning the rest to the player.",
    exampleQuestion: "If a creature has deathtouch and trample, how does damage work?",
    exampleAnswer: "Assign lethal (usually 1) to each blocker, then remaining damage can trample over to the defending player or planeswalker."
  },
  {
    id: "lifelink",
    name: "Lifelink",
    aliases: ["lifelink", "gain life from damage", "combat life gain"],
    shortAnswer: "Lifelink makes its controller gain life at the same time damage is dealt.",
    usesStack: "No",
    why: "Lifelink is a static ability that changes the damage event itself.",
    importantNuance: "It is not a trigger, so players cannot respond between damage being dealt and life gain.",
    exampleQuestion: "Can players respond before lifelink life gain happens?",
    exampleAnswer: "No separate trigger exists; life gain happens simultaneously with damage."
  },
  {
    id: "first-strike",
    name: "First Strike",
    aliases: ["first strike", "first strike combat", "combat damage step"],
    shortAnswer: "First strike creates an earlier combat-damage step for creatures with first strike or double strike.",
    usesStack: "No",
    why: "It changes combat timing, not via a triggered ability.",
    importantNuance: "If a creature dies in first-strike damage, it will not deal damage in the regular damage step.",
    exampleQuestion: "How does first strike work with double strike?",
    exampleAnswer: "Double strike deals damage in both steps. First strike only in the first step."
  },
  {
    id: "double-strike",
    name: "Double Strike",
    aliases: ["double strike", "two combat damage steps", "first strike and regular"],
    shortAnswer: "Double strike lets a creature deal combat damage in both first-strike and regular damage steps.",
    usesStack: "No",
    why: "It modifies how combat damage is assigned and dealt.",
    importantNuance: "If unblocked, it can effectively hit players twice in combat damage timing.",
    exampleQuestion: "How does first strike work with double strike?",
    exampleAnswer: "Double strike creature deals first-strike damage, then deals again in regular combat damage if still on battlefield."
  },
  {
    id: "trample",
    name: "Trample",
    aliases: ["trample", "excess damage", "damage to player", "damage assignment"],
    shortAnswer: "Trample lets excess combat damage go to the defending player or planeswalker after lethal damage is assigned to blockers.",
    usesStack: "No",
    why: "Trample is a static combat damage assignment rule.",
    importantNuance: "Lethal is calculated during assignment; with deathtouch, 1 damage can count as lethal.",
    exampleQuestion: "If a creature has deathtouch and trample, how does damage work?",
    exampleAnswer: "Assign minimal lethal to blockers, then assign remaining damage past them."
  },
  {
    id: "flash",
    name: "Flash",
    aliases: ["flash", "cast as though instant", "after blockers", "opponent turn"],
    shortAnswer: "Flash lets you cast the spell any time you could cast an instant.",
    usesStack: "No",
    why: "Flash changes casting timing permissions; the spell itself still uses the stack when cast.",
    importantNuance: "You can cast a flash creature after blockers are declared, but it will not become a blocker that combat.",
    exampleQuestion: "Can I cast a creature with flash after blockers?",
    exampleAnswer: "Yes, but it arrives too late to be declared as a blocker in that combat."
  },
  {
    id: "vigilance",
    name: "Vigilance",
    aliases: ["vigilance", "attacking doesn t tap", "attacking does not tap"],
    shortAnswer: "Vigilance means attacking does not tap that creature.",
    usesStack: "No",
    why: "It is a static combat rule modification.",
    importantNuance: "The creature is still attacking, so it can deal combat damage normally and remain untapped afterward.",
    exampleQuestion: "Does vigilance let me block after attacking?",
    exampleAnswer: "Usually yes, because it often remains untapped after attacking."
  },
  {
    id: "menace",
    name: "Menace",
    aliases: ["menace", "two or more blockers", "can t be blocked except"],
    shortAnswer: "A creature with menace can only be blocked by two or more creatures.",
    usesStack: "No",
    why: "Menace is a static blocking restriction.",
    importantNuance: "One blocker is illegal, but zero blockers is always legal.",
    exampleQuestion: "Can one creature block a menace attacker?",
    exampleAnswer: "No. It takes at least two creatures to block it."
  },
  {
    id: "equip",
    name: "Equip",
    aliases: ["equip", "attach equipment", "sorcery speed", "instant speed equip"],
    shortAnswer: "Equip can normally be activated only as a sorcery during your main phase with an empty stack.",
    usesStack: "Yes",
    why: "Equip is an activated ability and uses the stack when activated.",
    importantNuance: "You still need permission to activate it. Most equip abilities are sorcery-speed unless another card says otherwise.",
    exampleQuestion: "Can I equip at instant speed?",
    exampleAnswer: "Not by default. You need a specific effect that allows equip as though it had flash or at instant speed."
  },
  {
    id: "cascade",
    name: "Cascade",
    aliases: ["cascade", "exile until", "cast without paying mana cost"],
    shortAnswer: "When you cast a spell with cascade, you exile cards until a lower mana value nonland appears and may cast it.",
    usesStack: "Yes",
    why: "Cascade is a triggered ability that triggers on cast and resolves on the stack.",
    importantNuance: "Cascade resolves before the original spell if it was cast normally, because the trigger goes on top of that spell.",
    exampleQuestion: "Does cascade happen before the original spell resolves?",
    exampleAnswer: "Yes. The cascade trigger resolves first, then the original spell resolves later if still legal."
  }
];
