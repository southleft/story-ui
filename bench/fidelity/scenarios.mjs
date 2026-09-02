/**
 * Fidelity scenarios for a Mantine React project (react-mantine test env).
 *
 * Each scenario is a plain object. Kinds:
 *
 *   new        one generation from a prompt; optional followUps run against it
 *   update     generates (or reuses) `base`, then runs followUps that must be
 *              MINIMAL — scored by editDivergence against the file as it stood
 *   prop-edit  generates (or reuses) `base`, applies `propEdit` through
 *              POST /mcp/edit-prop, then runs followUps and asserts the pin
 *              survived the model's rewrite
 *   image      one generation with the PNG passed via --image (skipped, not
 *              failed, when no image is given)
 *
 * `expect` fields (all optional):
 *   mustUseComponents      every name must appear as JSX AND be imported from
 *                          the design system
 *   mustUseAnyOf           groups; each group needs at least one member used
 *   mustNotUseComponents   must not appear as JSX at all
 *   mustContainText        literal strings that must be in the code
 *   forbiddenPatterns      regex sources; DEFAULT_FORBIDDEN is always added
 *   maxDivergence          for follow-ups: editDivergence(previous, next) ceiling
 *   maxTimeToPreviewMs     time-to-preview_ready budget
 *
 * Expected component names are real `@mantine/core` exports. A group is used
 * wherever Mantine offers several correct answers: a three-column board is
 * legitimately SimpleGrid, Grid or Group.
 */

/**
 * Design-system adherence rules that apply to every scenario on a Mantine
 * project. Each is a regex source. They flag the model reaching past the
 * design system: raw colours, pixel spacing in inline styles, `!important`,
 * utility-class frameworks, and competing component libraries.
 */
export const DEFAULT_FORBIDDEN = [
  '#[0-9a-fA-F]{6}\\b',                                              // raw hex colour
  "style=\\{\\{[^}]*(?:padding|margin|gap):\\s*['\"]?\\d+px",        // inline pixel spacing
  '!important',
  "from ['\"](?:@mui/|@chakra-ui/|antd|react-bootstrap|@radix-ui/)",  // another design system
  "className=[\"'][^\"']*\\b(?:flex|grid|p-\\d|m-\\d|px-\\d|py-\\d|text-\\w+-\\d{3})\\b", // Tailwind utilities
];

export const scenarios = [
  /* ------------------------------------------------------------ new */
  {
    id: 'pricing-page',
    kind: 'new',
    prompt: 'A pricing page with three plan cards (Starter, Pro, Team) in a row, each with the plan name, a monthly price, a list of four features with check icons, and a call-to-action button. The Pro card is highlighted as "Most popular". Below the cards, an FAQ section with four questions in an accordion.',
    expect: {
      mustUseComponents: ['Card', 'Button', 'Accordion', 'Badge'],
      mustUseAnyOf: [['SimpleGrid', 'Grid', 'Group']],
      mustContainText: ['Starter', 'Pro', 'Team', 'Most popular'],
    },
  },
  {
    id: 'data-table',
    kind: 'new',
    prompt: 'A users data table with columns Name, Email, Role, Status and Last active. Above it, a search input and a role filter. Column headers for Name and Last active are sortable with a sort direction indicator. Each row has a row-actions menu with Edit, Reset password and Deactivate. Status is shown as a coloured badge. Include eight realistic rows.',
    expect: {
      mustUseComponents: ['Table', 'TextInput', 'Badge', 'Menu'],
      mustUseAnyOf: [['Select', 'SegmentedControl', 'NativeSelect']],
      mustContainText: ['Deactivate', 'Reset password'],
    },
  },
  {
    id: 'settings-page',
    kind: 'new',
    prompt: 'An account settings page with tabs for Profile, Notifications, Security and Billing. Profile has a form with first name, last name, email and a bio textarea plus a Save button. Notifications has a list of toggle switches. Security has a change-password form and a two-factor toggle. Billing shows the current plan and a payment method card.',
    expect: {
      mustUseComponents: ['Tabs', 'TextInput', 'Switch', 'Button'],
      mustUseAnyOf: [['Textarea', 'TextInput'], ['PasswordInput', 'TextInput']],
      mustContainText: ['Profile', 'Notifications', 'Security', 'Billing'],
    },
  },
  {
    id: 'analytics-dashboard',
    kind: 'new',
    prompt: 'An analytics dashboard: a row of four stat tiles (Revenue, Active users, Conversion rate, Churn) each with a value and a percentage change against last month; below that a large chart placeholder area titled "Revenue over time" with a period selector (7d, 30d, 90d); and beside it a recent activity feed with six timestamped entries.',
    expect: {
      mustUseComponents: ['Card', 'Text'],
      mustUseAnyOf: [['SimpleGrid', 'Grid'], ['Timeline', 'List', 'Stack'], ['SegmentedControl', 'Tabs', 'Select', 'Button']],
      mustContainText: ['Revenue', 'Active users', 'Churn'],
    },
  },
  {
    id: 'onboarding-checklist',
    kind: 'new',
    prompt: 'An onboarding checklist card for a new workspace: a heading "Get started", a progress bar showing 2 of 5 steps complete, and five steps (Create your profile, Invite teammates, Connect a data source, Create your first report, Set up alerts). Completed steps are checked and struck through; the next step has a primary action button; the rest are muted.',
    expect: {
      mustUseComponents: ['Progress', 'Button'],
      mustUseAnyOf: [['Checkbox', 'ThemeIcon', 'Stepper', 'Timeline']],
      mustContainText: ['Get started', 'Invite teammates', 'Set up alerts'],
    },
  },
  {
    id: 'kanban-board',
    kind: 'new',
    prompt: 'A kanban board with three columns: To do, In progress, Done. Each column has a header with the column name and a count badge, and three task cards. A task card shows a title, a priority badge (High, Medium, Low), an assignee avatar and a due date. The Done column cards look muted.',
    expect: {
      mustUseComponents: ['Card', 'Badge', 'Avatar'],
      mustUseAnyOf: [['SimpleGrid', 'Grid', 'Group', 'Flex']],
      mustContainText: ['To do', 'In progress', 'Done'],
    },
  },
  {
    id: 'multi-step-wizard',
    kind: 'new',
    prompt: 'A four-step signup wizard using a stepper: Account (email, password), Company (company name, size, industry), Preferences (a few checkboxes), Review (summary of what was entered). Back and Next buttons at the bottom, with Next becoming "Create account" on the last step. The story should show the wizard on step 2 with realistic values filled in.',
    expect: {
      mustUseComponents: ['Stepper', 'Button', 'TextInput'],
      mustUseAnyOf: [['Select', 'NativeSelect', 'Radio', 'SegmentedControl']],
      mustContainText: ['Account', 'Company', 'Preferences', 'Review'],
    },
  },
  {
    id: 'notification-centre',
    kind: 'new',
    prompt: 'A notification centre panel with a header ("Notifications", an unread count badge, and a "Mark all as read" button), then notifications grouped under Today, Yesterday and Earlier. Each item has an avatar or icon, a one-line message with the actor in bold, a relative time, and unread items show a small dot. Include seven items across the groups.',
    expect: {
      mustUseComponents: ['Badge', 'Button'],
      mustUseAnyOf: [['Avatar', 'ThemeIcon'], ['Indicator', 'Badge', 'Box', 'ColorSwatch']],
      mustContainText: ['Mark all as read', 'Today', 'Yesterday', 'Earlier'],
    },
  },
  {
    id: 'inventory-dashboard',
    kind: 'new',
    prompt: 'A product inventory dashboard: four stat tiles at the top (Total SKUs, Low stock, Out of stock, Inventory value), then a products table with SKU, Product, Category, Stock, Unit price and Status (In stock / Low / Out) as coloured badges, with ten rows, and pagination below the table showing page 1 of 8.',
    expect: {
      mustUseComponents: ['Table', 'Pagination', 'Badge'],
      mustUseAnyOf: [['SimpleGrid', 'Grid']],
      mustContainText: ['Low stock', 'Out of stock'],
    },
  },

  /* --------------------------------------------------------- update */
  {
    id: 'update-center-pagination',
    kind: 'update',
    base: 'inventory-dashboard',
    prompt: '(base) inventory-dashboard',
    followUps: [
      {
        prompt: 'Center the pagination.',
        expect: {
          maxDivergence: 0.15,
          mustUseComponents: ['Pagination', 'Table'],
        },
      },
    ],
  },
  {
    id: 'update-cta-text',
    kind: 'update',
    base: 'pricing-page',
    prompt: '(base) pricing-page',
    followUps: [
      {
        prompt: 'Make the primary button say "Start free trial".',
        expect: {
          maxDivergence: 0.1,
          mustContainText: ['Start free trial'],
          mustUseComponents: ['Card', 'Button'],
        },
      },
    ],
  },

  /* ------------------------------------------------------ prop-edit */
  {
    id: 'prop-edit-button-variant',
    kind: 'prop-edit',
    base: 'pricing-page',
    prompt: '(base) pricing-page',
    propEdit: { component: 'Button', occurrence: 0, prop: 'variant', value: 'outline' },
    followUps: [
      {
        prompt: 'Add a small "Compare all plans" link centred under the cards.',
        expect: {
          maxDivergence: 0.2,
          mustContainText: ['Compare all plans'],
          mustUseComponents: ['Card', 'Button'],
        },
      },
    ],
  },

  /* ---------------------------------------------------------- image */
  {
    id: 'image-layout',
    kind: 'image',
    prompt: 'Recreate the layout shown in this screenshot using the design system components. Match the structure, sections and hierarchy; use placeholder text where the image is unreadable.',
    expect: {
      // Loose on purpose: the image decides the content. It must still be
      // built from the design system's layout primitives.
      mustUseAnyOf: [['Container', 'Stack', 'Group', 'SimpleGrid', 'Grid', 'Card', 'Paper', 'Flex', 'Box']],
    },
  },
];

export const byId = (id) => scenarios.find(s => s.id === id);
