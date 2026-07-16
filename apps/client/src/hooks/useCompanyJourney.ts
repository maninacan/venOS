import { useCallback, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@org/data';

// Single round-trip across existing root fields — no backend changes needed.
const GET_JOURNEY = gql`
  query GetCompanyJourney($companyId: ID!) {
    company(id: $companyId) {
      id
      posSystem
      laborMethod
      posStatus { connected }
      members { userId }
    }
    eventKpi(companyId: $companyId) { totalEvents }
    recipes(companyId: $companyId) { id }
    inventory(companyId: $companyId) { id }
    posMappings(companyId: $companyId) { id inventoryItemId recipeId }
    posModifierMappings(companyId: $companyId) { id inventoryItemId recipeId }
  }
`;

interface MappingRow { inventoryItemId?: string | null; recipeId?: string | null }

export interface JourneyStep {
  key: string;
  label: string;
  description: string;
  ctaLabel: string;
  to: string;
  done: boolean;
  optional: boolean;
  skipped: boolean;
}

function readSet(key: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]') as string[]); }
  catch { return new Set(); }
}

export function useCompanyJourney(companyId: string | null) {
  const { t } = useTranslation('onboarding');
  const { user } = useAuth();
  const skipsKey = `venview_journey_skips_${companyId}`;
  const dismissKey = `venview_journey_dismissed_${companyId}`;

  const [skips, setSkips] = useState<Set<string>>(() => readSet(skipsKey));
  const [dismissed, setDismissedState] = useState<boolean>(() => localStorage.getItem(dismissKey) === '1');

  const { data, loading, refetch } = useQuery(GET_JOURNEY, { variables: { companyId }, skip: !companyId });

  const skipStep = useCallback((key: string) => {
    setSkips(prev => {
      const next = new Set(prev).add(key);
      localStorage.setItem(skipsKey, JSON.stringify([...next]));
      return next;
    });
  }, [skipsKey]);

  const dismiss = useCallback((value = true) => {
    setDismissedState(value);
    localStorage.setItem(dismissKey, value ? '1' : '0');
  }, [dismissKey]);

  const posConnected = !!data?.company?.posStatus?.connected;
  const memberCount = data?.company?.members?.length ?? 0;
  const recipeCount = data?.recipes?.length ?? 0;
  const inventoryCount = data?.inventory?.length ?? 0;
  const eventCount = data?.eventKpi?.totalEvents ?? 0;
  const posSystem = (data?.company?.posSystem ?? null) as string | null;
  const laborMethod = (data?.company?.laborMethod ?? null) as string | null;
  const answered = !!posSystem && !!laborMethod;
  const POS_LABELS: Record<string, string> = { square: 'Square', shopify: 'Shopify', toast: 'Toast' };
  const posName = posSystem && POS_LABELS[posSystem] ? POS_LABELS[posSystem] : t('steps.pos.genericPos', 'your POS');
  const languageChosen = !!user?.user_metadata?.['lang'];
  // A mapping "counts" only when it actually links a recipe or inventory item —
  // savePosMappings writes a row per catalog item, including unmapped ones.
  const itemMappingCount = ((data?.posMappings ?? []) as MappingRow[]).filter(m => m.inventoryItemId || m.recipeId).length;
  const modifierMappingCount = ((data?.posModifierMappings ?? []) as MappingRow[]).filter(m => m.inventoryItemId || m.recipeId).length;

  const base: Array<Omit<JourneyStep, 'skipped'>> = [
    {
      key: 'language', label: t('steps.language.label', 'Choose your language'), description: t('steps.language.description', 'Pick your display language and currency.'),
      ctaLabel: t('steps.language.cta', 'Choose language'), to: `/companies/${companyId}/settings#language`, done: languageChosen, optional: false,
    },
    {
      key: 'company', label: t('steps.company.label', 'Create your company'), description: t('steps.company.description', 'Your workspace for events, recipes, and inventory.'),
      ctaLabel: t('steps.company.cta', 'Done'), to: `/companies/${companyId}/settings`, done: true, optional: false,
    },
    {
      key: 'pos', label: t('steps.pos.label', 'Connect {{pos}}', { pos: posName }), description: t('steps.pos.description', 'Auto-sync sales (and labor) from your POS.'),
      ctaLabel: t('steps.pos.cta', 'Connect {{pos}}', { pos: posName }), to: `/companies/${companyId}/settings?setup=1`, done: posConnected, optional: true,
    },
    {
      key: 'recipes', label: t('steps.recipes.label', 'Add your recipes'), description: t('steps.recipes.description', 'Define ingredient costs so venOS can calculate COGS.'),
      ctaLabel: t('steps.recipes.cta', 'Add recipes'), to: `/companies/${companyId}/recipes?setup=1`, done: recipeCount > 0, optional: true,
    },
    {
      key: 'inventory', label: t('steps.inventory.label', 'Add your inventory'), description: t('steps.inventory.description', 'Import your product catalog to track stock and costs.'),
      ctaLabel: t('steps.inventory.cta', 'Add inventory'), to: `/companies/${companyId}/inventory?setup=1`, done: inventoryCount > 0, optional: true,
    },
    {
      key: 'pos-item-mapping', label: t('steps.posItemMapping.label', 'Map POS items to recipes'), description: t('steps.posItemMapping.description', 'Link each POS product to a recipe so COGS is calculated automatically.'),
      ctaLabel: t('steps.posItemMapping.cta', 'Map items'), to: `/companies/${companyId}/settings?setup=1&posMapping=1`, done: itemMappingCount > 0, optional: true,
    },
    {
      key: 'pos-modifier-mapping', label: t('steps.posModifierMapping.label', 'Map POS modifiers'), description: t('steps.posModifierMapping.description', 'Link modifiers (add-ons, sizes) to inventory so their cost is counted.'),
      ctaLabel: t('steps.posModifierMapping.cta', 'Map modifiers'), to: `/companies/${companyId}/settings?setup=1&posModifierMapping=1`, done: modifierMappingCount > 0, optional: true,
    },
    {
      key: 'team', label: t('steps.team.label', 'Invite your team'), description: t('steps.team.description', 'Share events, inventory, and recipes with teammates.'),
      ctaLabel: t('steps.team.cta', 'Invite team'), to: `/companies/${companyId}/settings?setup=1#team-access`, done: memberCount > 1, optional: true,
    },
    {
      key: 'first-event', label: t('steps.firstEvent.label', 'Create your first event'), description: t('steps.firstEvent.description', 'Add a market, festival, or pop-up to start tracking profit.'),
      ctaLabel: t('steps.firstEvent.cta', 'Create event'), to: `/companies/${companyId}/events/new?setup=1`, done: eventCount > 0, optional: false,
    },
  ];

  // Personalize from onboarding answers: a manual-POS company doesn't need the
  // POS connection step, and the mapping steps only make sense once a (non-manual)
  // POS is connected — the mappers read the live POS catalog, empty otherwise.
  const filtered = base.filter(s => {
    if (s.key === 'pos' && posSystem === 'manual') return false;
    if ((s.key === 'pos-item-mapping' || s.key === 'pos-modifier-mapping') && (posSystem === 'manual' || !posConnected)) return false;
    return true;
  });
  const steps: JourneyStep[] = filtered.map(s => ({ ...s, skipped: skips.has(s.key) }));

  // Core path = company exists + first event created.
  const coreComplete = eventCount > 0;
  // The actionable steps still worth showing.
  const activeSteps = steps.filter(s => !s.done && !s.skipped);
  const doneCount = steps.filter(s => s.done).length;

  return { loading, steps, activeSteps, coreComplete, dismissed, dismiss, skipStep, doneCount, total: steps.length, posSystem, laborMethod, answered, refetch };
}
