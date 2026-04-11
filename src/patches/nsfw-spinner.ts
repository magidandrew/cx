/**
 * NSFW Spinner Patch
 *
 * Replaces the SPINNER_VERBS array with a list of NSFW -ing verbs. Only
 * touches the in-progress spinner array (Xs1, starting with "Accomplishing")
 * — leaves the past-tense TURN_COMPLETION_VERBS array alone.
 *
 * Conflicts with simple-spinner, which overwrites the same array.
 */

import type { Patch } from '../types.js';

const NSFW_VERBS = [
  'Gooning',
  'Cunningulating',
  'Blowing',
  'Fellatiating',
  'Sexting',
  'Dripping',
  'Queefing',
  'Sounding',
  'Orgasming',
  'Copulating',
  'Groping',
  'Fondling',
  'Seducing',
  'Shagging',
  'Boning',
  'Fornicating',
  'Penetrating',
  'Sodomizing',
  'Smooching',
  'Caressing',
  'Canoodling',
  'Climaxing',
  'Fingering',
  'Spanking',
  'Lubing',
  'Stripping',
  'Skinny-dipping',
  'Whipping',
  'Paddling',
  'Pleasuring',
  'Scissoring',
  'Humping',
  'Swallowing',
  'Spitting',
  'Pegging',
  'Edging',
  'Moaning',
  'Squirting',
  'Motorboating',
  'Breeding',
  '69ing',
];

const patch: Patch = {
  id: 'nsfw-spinner',
  name: 'NSFW Spinner',
  description: 'Replace spinner verbs with NSFW ones',
  defaultEnabled: false,
  tag: 'nsfw',
  conflictsWith: ['simple-spinner'],

  apply(ctx) {
    const { ast, editor, query, assert } = ctx;
    const { findArrayWithConsecutiveStrings } = query;

    // SPINNER_VERBS — the same array simple-spinner targets.
    const spinnerArr = findArrayWithConsecutiveStrings(ast, 'Accomplishing', 'Actioning');
    assert(spinnerArr, 'Could not find SPINNER_VERBS array (looked for "Accomplishing","Actioning")');
    editor.replaceRange(spinnerArr.start, spinnerArr.end, JSON.stringify(NSFW_VERBS));
  },
};

export default patch;
