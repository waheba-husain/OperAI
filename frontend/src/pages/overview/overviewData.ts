/* ============================================================
   src/pages/overview/overviewData.ts
   Illustrative demo data for the OperAI Overview dashboard.
   DATA INTEGRITY NOTE (per AGENTS.md rule 9):
   All data here has data_source = 'simulated'.
   These values are realistic kitchen benchmarks provided for UI
   preview and demonstration only; no real backend connection is active.
   ============================================================ */

import type {
  KpiItem,
  AiKitchenBriefing,
  HourlyPerformancePoint,
  StationHealth,
  IngredientAlert,
  PrepTaskItem,
} from '../../types/overview'

export const DEMO_METADATA = {
  dataSource: 'simulated',
  kitchenName: 'Cloud Kitchen Central #04',
  activeShift: 'Shift 1 (Morning & Lunch Service)',
  planVersion: 'Plan v1.4 (Locked)',
  lastSync: 'Today at 08:00 AM (Demo snapshot)',
} as const

export const DEMO_KPIS: readonly KpiItem[] = [
  {
    id: 'orders-today',
    label: 'Orders Today',
    value: '142',
    supportingText: '+18% vs yesterday · 94% on-time',
    trend: { direction: 'up', text: '+18% vol' },
    variant: 'primary',
    icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 1 1 6 0H9z',
  },
  {
    id: 'revenue-today',
    label: 'Revenue Today',
    value: '₹3,18,800',
    supportingText: 'Simulated revenue — INR · demo data only',
    trend: { direction: 'up', text: 'On track' },
    variant: 'revenue',
    icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  },
  {
    id: 'profit-margin',
    label: 'Avg Dish Margin',
    value: '68.4%',
    supportingText: '+2.1% after yesterday’s dairy substitution',
    trend: { direction: 'up', text: '+2.1% margin' },
    variant: 'margin',
    icon: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 0 1-3 0V7a1.5 1.5 0 0 1 3 0z',
  },
  {
    id: 'orders-attention',
    label: 'Attention Needed',
    value: '3',
    supportingText: '2 pending ingredient swaps · 1 prep lag',
    trend: { direction: 'down', text: 'Action required' },
    variant: 'attention',
    icon: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4m0 4h.01',
  },
]

export const DEMO_AI_BRIEFING: AiKitchenBriefing = {
  title: 'OperAI Morning Kitchen Briefing',
  timestamp: 'Generated today at 07:45 AM',
  statusBadge: 'Simulated AI Co-Pilot',
  observations: [
    {
      id: 'obs-1',
      tag: 'Shortage Horizon',
      text: 'Heavy Cream inventory is 3.2L below projected dinner service demand. Stockout expected ~18:30 during the dinner rush.',
      urgency: 'alert',
    },
    {
      id: 'obs-2',
      tag: 'Margin Improvement',
      text: 'Truffle Pasta margin reached 72.4% following the Greek yogurt & butter blend substitution approved yesterday.',
      urgency: 'positive',
    },
    {
      id: 'obs-3',
      tag: 'Station Pacing',
      text: 'Station 2 (Grill & Sauté) is pacing 12 minutes behind schedule. Consider unlocking and shifting Task #4 if delay exceeds 15 min.',
      urgency: 'notice',
    },
  ],
  recommendedAction: {
    description: 'Review simulated recovery options for Heavy Cream shortage before the 11:30 lunch batch begins.',
    targetLabel: 'View Shortage Recovery',
    targetPageId: 'shortage-recovery',
  },
}

export const DEMO_HOURLY_PERFORMANCE: readonly HourlyPerformancePoint[] = [
  { time: '08:00', revenue: 15400, orders: 6 },
  { time: '09:00', revenue: 24550, orders: 11 },
  { time: '10:00', revenue: 34100, orders: 16 },
  { time: '11:00', revenue: 53250, orders: 24 },
  { time: '12:00', revenue: 74100, orders: 35, peak: true },
  { time: '13:00', revenue: 63250, orders: 29 },
  { time: '14:00', revenue: 34950, orders: 15 },
  { time: '15:00', revenue: 19950, orders: 6 },
]

export const DEMO_STATION_HEALTH: readonly StationHealth[] = [
  {
    id: 'st-1',
    name: 'Station 1: Prep & Cold Pantry',
    utilizationPct: 65,
    activeCooks: 2,
    status: 'normal',
  },
  {
    id: 'st-2',
    name: 'Station 2: Grill & Sauté Line',
    utilizationPct: 92,
    activeCooks: 3,
    status: 'busy',
  },
  {
    id: 'st-3',
    name: 'Station 3: Bake & Pastry Deck',
    utilizationPct: 45,
    activeCooks: 1,
    status: 'light',
  },
  {
    id: 'st-4',
    name: 'Station 4: Assembly & Expo Gate',
    utilizationPct: 78,
    activeCooks: 2,
    status: 'normal',
  },
]

export const DEMO_INGREDIENT_ALERTS: readonly IngredientAlert[] = [
  {
    id: 'ing-1',
    name: 'Heavy Cream (36% Butterfat)',
    category: 'Dairy',
    currentStock: '1.8 L',
    requiredStock: '5.0 L',
    deficit: '-3.2 L',
    impactTime: 'Expected at 18:30',
    urgency: 'critical',
    affectedDishesCount: 4,
  },
  {
    id: 'ing-2',
    name: 'Fresh Sweet Basil',
    category: 'Fresh Produce',
    currentStock: '220 g',
    requiredStock: '400 g',
    deficit: '-180 g',
    impactTime: 'Expected at 14:00',
    urgency: 'warning',
    affectedDishesCount: 2,
  },
  {
    id: 'ing-3',
    name: 'Arborio Risotto Rice',
    category: 'Dry Goods',
    currentStock: '3.2 kg',
    requiredStock: '4.0 kg min',
    deficit: '-0.8 kg',
    impactTime: 'Next Delivery: Tomorrow 09:00',
    urgency: 'info',
    affectedDishesCount: 1,
  },
]

export const DEMO_PREP_TASKS: readonly PrepTaskItem[] = [
  {
    id: 'task-1',
    title: 'Morning Mirepoix & Bone Broth Reduction',
    station: 'Station 1: Prep',
    timeWindow: '07:30 – 09:00',
    priority: 'high',
    status: 'completed',
    progressPct: 100,
  },
  {
    id: 'task-2',
    title: 'Marinate Free-Range Chicken Breast',
    station: 'Station 2: Grill',
    timeWindow: '09:15 – 10:30',
    priority: 'high',
    status: 'in-progress',
    progressPct: 65,
  },
  {
    id: 'task-3',
    title: 'Portion Egg Tagliatelle & Gnocchi',
    station: 'Station 3: Bake',
    timeWindow: '10:30 – 11:15',
    priority: 'medium',
    status: 'upcoming',
    progressPct: 0,
  },
  {
    id: 'task-4',
    title: 'Sous-Vide Wagyu Short Ribs (Dinner Service)',
    station: 'Station 2: Grill',
    timeWindow: '11:30 – 14:30',
    priority: 'critical',
    status: 'locked',
    isLocked: true,
    progressPct: 0,
  },
  {
    id: 'task-5',
    title: 'Herb Infused Oils & Clarified Butter',
    station: 'Station 1: Prep',
    timeWindow: '14:45 – 15:30',
    priority: 'low',
    status: 'upcoming',
    progressPct: 0,
  },
]
