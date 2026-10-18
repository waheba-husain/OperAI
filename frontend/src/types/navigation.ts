/* ============================================================
   src/types/navigation.ts
   Navigation types and route data for the OperAI app shell.
   NAV_ITEMS is the single source of truth for the sidebar,
   top-nav title, and placeholder page content.
   ============================================================ */

export type PageId =
  | 'overview'
  | 'live-operations'
  | 'schedule-plan'
  | 'shortage-recovery'
  | 'orders'
  | 'menu-pricing'
  | 'audit-log'

export interface NavItem {
  readonly id: PageId
  readonly label: string
  readonly description: string
  readonly upcomingFeatures: readonly string[]
  /** Feather-style SVG path data for a 24×24 stroke icon. */
  readonly iconPath: string
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    description:
      'Morning brief, plan status, and kitchen health at a glance. The single screen a kitchen owner opens first.',
    upcomingFeatures: [
      'Evening brief with risk and revenue exposure',
      'Before/after impact comparison card',
      'Active plan version and status badge',
      'Kitchen health and throughput summary',
    ],
    iconPath: 'M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm11 0h7v7h-7v-7z',
  },
  {
    id: 'live-operations',
    label: 'Live Operations',
    description:
      'Real-time prep schedule, station assignments, and active task monitoring across the kitchen.',
    upcomingFeatures: [
      'Real-time prep task timeline',
      'Station and cook assignments',
      'Locked-task indicators',
      'Live order queue integration',
    ],
    iconPath: 'M22 12h-4l-3 9L9 3l-3 9H2',
  },
  {
    id: 'schedule-plan',
    label: 'Schedule & Plan',
    description:
      "Today's constraint-solved prep plan with deadline-first task ordering and a full plan version history.",
    upcomingFeatures: [
      'Constraint-solver generated prep schedule',
      'Deadline-first task prioritisation',
      'Replanning with locked-task protection',
      'Plan version history and comparison',
    ],
    iconPath:
      'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  },
  {
    id: 'shortage-recovery',
    label: 'Shortage & Recovery',
    description:
      'Proactively detected ingredient shortages with simulation-generated recovery options and voice-verified approval.',
    upcomingFeatures: [
      'Proactive ingredient shortage detection',
      'Simulation-generated recovery options',
      'Voice-verified option approval (confirm option number)',
      'Do-nothing baseline vs option impact card',
    ],
    iconPath:
      'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4m0 4h.01',
  },
  {
    id: 'orders',
    label: 'Orders',
    description:
      'Incoming orders, WhatsApp paste-to-extract, structured validation, and customer message drafts.',
    upcomingFeatures: [
      'WhatsApp order paste and AI extraction',
      'Structured order validation with Pydantic',
      'Customer message drafts (wa.me links)',
      'Order status and fulfilment tracking',
    ],
    iconPath:
      'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 1 1 6 0H9z',
  },
  {
    id: 'menu-pricing',
    label: 'Menu & Pricing',
    description:
      'Ingredient costs, dish margin analysis, and allergen-checked substitution suggestions.',
    upcomingFeatures: [
      'Ingredient cost and margin analysis',
      'Validated substitution suggestions',
      'Allergen and diet tag checking',
      'Price adjustment approval workflow',
    ],
    iconPath:
      'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01',
  },
  {
    id: 'audit-log',
    label: 'Audit Log',
    description:
      'Append-only history of every approved action with before/after snapshots, undo queue, and plan version timeline.',
    upcomingFeatures: [
      'Complete approved action history',
      'Before/after state snapshots',
      'Undo queue for reversible actions',
      'Plan version timeline and diff view',
    ],
    iconPath:
      'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm0-14v6l4 2',
  },
]
