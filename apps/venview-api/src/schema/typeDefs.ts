export const typeDefs = `#graphql

  scalar JSON

  # ─── User ────────────────────────────────────────────────────────────────────
  type Me {
    id: ID!
    email: String!
    isSuperAdmin: Boolean!
    companies: [Company!]!
    "Companies the user has requested to join but that are awaiting owner approval."
    pendingCompanies: [Company!]!
  }

  # ─── Company ─────────────────────────────────────────────────────────────────
  type Company {
    id: ID!
    name: String!
    phone: String
    contactName: String
    vendorCategory: String
    email: String
    ownerId: ID!
    joinCode: String
    plan: String!
    "ISO 4217 currency code the merchant transacts in (defaults to 'USD'). Amounts are shown in this currency, POS-style."
    currency: String!
    "ISO 3166-1 alpha-2 country new events default to (defaults to 'US')."
    defaultCountry: String!
    subscriptionStatus: String
    currentPeriodEnd: String
    createdAt: String
    members: [CompanyMember!]!
    pendingRequests: [CompanyMember!]!
    "User id with a pending ownership offer, if any."
    pendingOwnerId: ID
    posStatus: PosStatus
    "True when a TaxJar API token is stored for this company (the token itself is never exposed)."
    taxjarConnected: Boolean
    "Onboarding answer: 'square' | 'manual' (others reserved)."
    posSystem: String
    "Onboarding answer: 'pos' | 'other' | 'flat_rate'."
    laborMethod: String
    "For a pending company (from pendingCompanies): when the current user last reminded the owner; null otherwise."
    lastRemindedAt: String
  }

  type RemindResult {
    ok: Boolean!
    "When the reminder was sent — drives the client-side cooldown."
    lastRemindedAt: String!
  }

  type AccessRequestResult {
    companyName: String!
    "'pending' for a new/awaiting request, 'active' if already a member."
    status: String!
  }

  type InviteResult {
    email: String!
    "'invited' (email sent to a new user), 'added' (existing user added), or 'exists' (already a member)."
    status: String!
  }

  type CompanyMember {
    userId: ID!
    email: String!
    role: String!
  }

  input CreateCompanyInput {
    name: String!
    phone: String
    contactName: String
    vendorCategory: String
    email: String
  }

  input UpdateCompanyInput {
    name: String
    phone: String
    contactName: String
    vendorCategory: String
    email: String
    "ISO 4217 currency code (e.g. 'USD', 'MXN')."
    currency: String
    "ISO 3166-1 alpha-2 country new events default to (e.g. 'US', 'CA')."
    defaultCountry: String
  }

  # ─── Events ──────────────────────────────────────────────────────────────────
  type Event {
    id: ID!
    companyId: ID!
    eventName: String!
    eventDate: String
    endDate: String
    status: String
    eventType: String
    eventHost: String
    eventLocation: String
    coordinator: String
    notes: String
    zipCode: String
    "ISO 3166-1 alpha-2 country code (e.g. 'US'). Defaults from the company on create."
    country: String
    posLocationId: String
    time: String
    applicationDate: String
    eventRating: String
    permits: String
    employees: String
    customFields: JSON
    numDays: Int
    isFinalized: Boolean!
    finalizedDate: String
    days: [EventDay!]!
    netProfit: Float
    sales: SalesSummary
  }

  type EventDay {
    id: ID!
    dayNumber: Int!
    date: String
    startTime: String
    endTime: String
  }

  type SalesSummary {
    grossSales: Float
    netSales: Float
    discounts: Float
    refunds: Float
    tax: Float
    tips: Float
    squareFees: Float
    posFees: Float
    taxRate: Float
    stateTaxRate: Float
    localTaxRate: Float
    taxCollected: Float
    taxJurisdiction: JSON
    taxOverride: Boolean
    totalCollected: Float
  }

  type EventExpenses {
    healthDeptFee: Float
    eventFee: Float
    mileage: Float
    mileageRate: Float
    laborFees: Float
    suppliesTotal: Float
    coordinatorFee: Float
    additionalFees: Float
    posFee: Float
    employeeBonus: Float
    eventRunnerFees: Float
  }

  type LaborEntry {
    id: ID!
    employeeId: ID
    name: String
    hours: Float
    wage: Float
    flatRate: Float
    total: Float
  }

  type Supply {
    id: ID!
    name: String!
    quantity: Float
    unitCost: Float
    total: Float
    inventoryItemId: ID
  }

  type AdditionalFee {
    id: ID!
    label: String!
    amount: Float!
    isDiscount: Boolean!
    "How amount is interpreted: 'flat' | 'per_unit' | 'percentage'."
    calcType: String!
    "For percentage rows: 'gross' | 'net' (the sales base the percent applies to)."
    pctBase: String
  }

  type Permit {
    id: ID!
    fileName: String!
    "Short-lived signed URL minted on read (files are stored privately)."
    fileUrl: String
    uploadedAt: String
  }

  type TaxInfo {
    stateRate: Float
    localRate: Float
    combinedRate: Float
    stateTax: Float
    localTax: Float
    taxCollected: Float
    jurisdiction: JSON
    stateFoodTax: Float
    taxDetail: JSON
  }

  type ReportSummary {
    posFees: Float
    cogs: Float
    grossProfit: Float
    totalExpenses: Float
    netProfit: Float
    tips: Float
    stateFoodTax: Float
    laborFees: Float
    additionalFeesTotal: Float
    mileageReimbursement: Float
  }

  type InventorySaleRow {
    name: String
    quantitySold: Float
    unitPrice: Float
    totalCost: Float
    "Name of the recipe this item's COGS came from, when matched via a recipe."
    recipeName: String
  }

  type EventReport {
    event: Event
    sales: SalesSummary
    expenses: EventExpenses
    taxes: TaxInfo
    summary: ReportSummary
    inventorySales: [InventorySaleRow!]!
    laborEntries: [LaborEntry!]!
    supplies: [Supply!]!
    additionalFees: [AdditionalFee!]!
  }

  type EventKpi {
    totalEvents: Int!
    finalizedCount: Int!
    grossSales: Float!
    netSales: Float!
  }

  type EventTrend {
    eventId: ID!
    name: String!
    date: String!
    netProfit: Float!
  }

  input CreateEventInput {
    eventName: String!
    eventDate: String
    endDate: String
    status: String
    eventType: String
    eventHost: String
    eventLocation: String
    coordinator: String
    notes: String
    zipCode: String
    "ISO 3166-1 alpha-2 country code (e.g. 'US'). Defaults from the company on create."
    country: String
    posLocationId: String
    time: String
    applicationDate: String
    eventRating: String
    permits: String
    employees: String
    numDays: Int
    customFields: JSON
    days: [EventDayInput!]
  }

  input EventDayInput {
    dayNumber: Int!
    eventDate: String
    startTime: String
    endTime: String
  }

  input UpdateEventInput {
    eventName: String
    eventDate: String
    endDate: String
    status: String
    eventType: String
    eventHost: String
    eventLocation: String
    coordinator: String
    notes: String
    zipCode: String
    "ISO 3166-1 alpha-2 country code (e.g. 'US'). Defaults from the company on create."
    country: String
    posLocationId: String
    time: String
    applicationDate: String
    eventRating: String
    permits: String
    employees: String
    numDays: Int
    customFields: JSON
    days: [EventDayInput!]
  }

  input ManualSalesInput {
    grossSales: Float
    refunds: Float
    discounts: Float
    totalCollected: Float
  }

  input ExpensesInput {
    healthDeptFee: Float
    eventFee: Float
    mileage: Float
    mileageRate: Float
    coordinatorFee: Float
    posFee: Float
    employeeBonus: Float
    eventRunnerFees: Float
  }

  input LaborEntryInput {
    employeeId: ID
    name: String
    hours: Float
    wage: Float
    "Fixed amount for the shift; when set, overrides hours × wage."
    flatRate: Float
  }

  input SupplyInput {
    name: String!
    quantity: Float
    unitCost: Float
    inventoryItemId: ID
  }

  input AdditionalFeeInput {
    label: String!
    amount: Float!
    isDiscount: Boolean!
    "'flat' | 'per_unit' | 'percentage' (defaults to 'flat' if omitted)."
    calcType: String
    "'gross' | 'net' — only used when calcType is 'percentage'."
    pctBase: String
  }

  # ─── Employees ───────────────────────────────────────────────────────────────
  type Employee {
    id: ID!
    companyId: ID!
    name: String!
    defaultWage: Float
  }

  # ─── Recipes ─────────────────────────────────────────────────────────────────
  type Recipe {
    id: ID!
    companyId: ID!
    name: String!
    totalCost: Float
    ingredients: [RecipeIngredient!]!
  }

  type RecipeIngredient {
    id: ID!
    name: String!
    quantity: Float!
    unitCost: Float!
    unit: String
  }

  input CreateRecipeInput {
    name: String!
    ingredients: [RecipeIngredientInput!]!
  }

  input RecipeIngredientInput {
    name: String!
    quantity: Float!
    unitCost: Float!
    unit: String
  }

  # ─── Inventory ───────────────────────────────────────────────────────────────
  type InventoryItem {
    id: ID!
    companyId: ID!
    name: String!
    category: String
    unitCost: Float!
    quantityOnHand: Float
    reorderThreshold: Float
    sku: String
  }

  type InventoryAlert {
    id: ID!
    item: InventoryItem!
    triggeredAt: String!
    isRead: Boolean!
  }

  type PosMapping {
    id: ID!
    posItemId: String!
    posItemName: String
    variationName: String
    inventoryItemId: ID
    recipeId: ID
  }

  type EventInventory {
    id: ID!
    item: InventoryItem!
    quantityLoaded: Float!
    quantitySold: Float
    quantityRemaining: Float
  }

  input UpdateInventoryItemInput {
    name: String
    category: String
    unitCost: Float
    quantityOnHand: Float
    reorderThreshold: Float
    sku: String
  }

  input CreateInventoryItemInput {
    name: String!
    category: String
    unitCost: Float
    quantityOnHand: Float
    reorderThreshold: Float
    sku: String
  }

  input PosMappingInput {
    posSystem: String!
    posItemId: String!
    posItemName: String
    variationName: String
    inventoryId: ID
    recipeId: ID
  }

  # ─── Square ──────────────────────────────────────────────────────────────────
  type PosStatus {
    connected: Boolean!
    provider: String
    locationName: String
    locationId: String
    "True when the last POS API call failed auth — the user should reconnect."
    needsReauth: Boolean
  }

  type PosLocation {
    id: String!
    name: String!
    "ISO 4217 currency code reported by the POS for this location, if known."
    currency: String
  }

  type PosCatalogItem {
    posItemId: String!
    posItemName: String!
    variationName: String
    price: Float
  }

  "An AI-suggested mapping for one POS item — reviewed/accepted by the user before saving."
  type PosMappingRecommendation {
    posItemId: String!
    recipeId: ID
    inventoryId: ID
    "Model confidence in the match, 0.0–1.0."
    confidence: Float
    "Short human-readable rationale for the suggested match."
    reason: String
  }

  type SyncResult {
    success: Boolean!
    message: String
    unmatchedCount: Int
  }

  # ─── Admin ───────────────────────────────────────────────────────────────────
  type AdminUser {
    userId: ID!
    email: String!
    companyCount: Int!
    companies: [AdminCompany!]!
  }

  type AdminCompany {
    id: ID!
    name: String!
    plan: String!
    memberCount: Int!
  }

  type AdminCompanyMember {
    userId: ID!
    email: String!
    role: String!
    "'active' or 'pending' (awaiting approval)."
    status: String!
    joinedAt: String
  }

  type AdminCompanyDetail {
    id: ID!
    name: String!
    plan: String!
    ownerId: ID
    ownerEmail: String
    createdAt: String
    "Count of active members."
    memberCount: Int!
    members: [AdminCompanyMember!]!
  }

  type WaitlistSignup {
    id: ID!
    email: String!
    "Which marketing form the email came from ('hero' | 'cta'), if known."
    source: String
    createdAt: String
  }

  type MonthCount {
    month: String!
    count: Int!
  }

  type ZipCount {
    zipCode: String!
    count: Int!
  }

  type StateCount {
    state: String!
    count: Int!
  }

  type CountryCount {
    "ISO 3166-1 alpha-2 country code (e.g. 'US', 'CA')."
    country: String!
    count: Int!
  }

  type CompanyLocation {
    id: ID!
    name: String!
    plan: String!
    lat: Float!
    lng: Float!
    city: String
    zipCode: String
    "ISO 3166-1 alpha-2 country code (e.g. 'US'). Defaults from the company on create."
    country: String
    eventCount: Int!
    memberCount: Int!
  }

  type AdminDashboard {
    # Totals
    totalUsers: Int!
    totalCompanies: Int!
    totalEvents: Int!
    totalFinalizedEvents: Int!
    # Growth — trailing 30 days
    newUsers30d: Int!
    newCompanies30d: Int!
    newEvents30d: Int!
    newFinalizedEvents30d: Int!
    # Plans
    proCount: Int!
    starterCount: Int!
    # Activation
    activatedCompanies: Int!
    activationRate: Float!
    # Integrations
    squareConnectedCount: Int!
    squareConnectedRate: Float!
    # Engagement
    avgEventsPerCompany: Float!
    avgNetProfitPerEvent: Float
    # Health signals
    companiesInactive60d: Int!
    starterAtLimit: Int!
    # Trends (last 6 months)
    companiesByMonth: [MonthCount!]!
    eventsByMonth: [MonthCount!]!
    # Geography
    topZipCodes: [ZipCount!]!
    eventsByState: [StateCount!]!
    eventsByCountry: [CountryCount!]!
  }

  # ─── Queries ─────────────────────────────────────────────────────────────────
  type Query {
    me: Me

    company(id: ID!): Company
    posLocations(companyId: ID!): [PosLocation!]!
    posCatalog(companyId: ID!): [PosCatalogItem!]!

    events(companyId: ID!, filter: String, search: String, page: Int): [Event!]!
    event(id: ID!): Event
    eventReport(id: ID!): EventReport
    eventKpi(companyId: ID!): EventKpi!
    eventTrend(companyId: ID!): [EventTrend!]!

    employees(companyId: ID!): [Employee!]!

    recipes(companyId: ID!): [Recipe!]!

    inventory(companyId: ID!): [InventoryItem!]!
    inventoryAlerts(companyId: ID!): [InventoryAlert!]!
    lowStockItems(companyId: ID!): [InventoryItem!]!
    posMappings(companyId: ID!): [PosMapping!]!
    "AI-suggested POS→recipe/inventory mappings for the user to review (nothing is persisted)."
    posMappingRecommendations(companyId: ID!): [PosMappingRecommendation!]!
    eventInventory(eventId: ID!): [EventInventory!]!

    adminUsers: [AdminUser!]!
    adminCompanies: [AdminCompanyDetail!]!
    adminDashboard: AdminDashboard!
    companiesInState(state: String!): [CompanyLocation!]!
    waitlistSignups: [WaitlistSignup!]!
  }

  # ─── Mutations ───────────────────────────────────────────────────────────────
  type Mutation {
    # Company
    createCompany(input: CreateCompanyInput!): Company!
    updateCompany(id: ID!, input: UpdateCompanyInput!): Company!
    deleteCompany(id: ID!): Boolean!
    requestAccess(joinCode: String!): AccessRequestResult!
    "Re-notify the owner about a pending join request. Rate-limited server-side."
    remindJoinRequest(companyId: ID!): RemindResult!
    approveMember(companyId: ID!, userId: ID!): Boolean!
    inviteMember(companyId: ID!, email: String!): InviteResult!
    setCompanyProfile(companyId: ID!, posSystem: String, laborMethod: String): Company!
    setTaxjarToken(companyId: ID!, token: String!): Boolean!
    removeTaxjarToken(companyId: ID!): Boolean!
    leaveCompany(companyId: ID!): Boolean!
    offerOwnership(companyId: ID!, newOwnerId: ID!): Boolean!
    acceptOwnership(companyId: ID!): Boolean!
    declineOwnership(companyId: ID!): Boolean!
    removeMember(companyId: ID!, userId: ID!): Boolean!

    # Events
    createEvent(companyId: ID!, input: CreateEventInput!): Event!
    updateEvent(id: ID!, input: UpdateEventInput!): Event!
    "Clone an event's setup into a fresh, non-finalized event."
    duplicateEvent(id: ID!): Event!
    deleteEvent(id: ID!): Boolean!
    finalizeEvent(id: ID!): Event!
    claimUnownedEvents(companyId: ID!): Int!

    # Sales
    syncSales(eventId: ID!): SyncResult!
    updateManualSales(eventId: ID!, input: ManualSalesInput!): SalesSummary!
    setEventTaxRates(eventId: ID!, stateTaxRate: Float!, localTaxRate: Float!): SalesSummary!
    refreshEventTaxRates(eventId: ID!): SalesSummary!
    updateAdjustments(eventId: ID!, tips: Float, posFee: Float): Boolean!

    # Expenses
    updateExpenses(eventId: ID!, input: ExpensesInput!): EventExpenses!

    # Labor
    syncLabor(eventId: ID!): SyncResult!
    createLaborEntry(eventId: ID!, input: LaborEntryInput!): LaborEntry!
    updateLaborEntry(id: ID!, input: LaborEntryInput!): LaborEntry!
    deleteLaborEntry(id: ID!): Boolean!

    # Employees
    createEmployee(companyId: ID!, name: String!, defaultWage: Float): Employee!
    updateEmployee(id: ID!, name: String, defaultWage: Float): Employee!
    deleteEmployee(id: ID!): Boolean!

    # Supplies
    createSupply(eventId: ID!, input: SupplyInput!): Supply!
    updateSupply(id: ID!, input: SupplyInput!): Supply!
    deleteSupply(id: ID!): Boolean!

    # Additional fees
    createAdditionalFee(eventId: ID!, input: AdditionalFeeInput!): AdditionalFee!
    updateAdditionalFee(id: ID!, input: AdditionalFeeInput!): AdditionalFee!
    deleteAdditionalFee(id: ID!): Boolean!

    # Recipes
    createRecipe(companyId: ID!, input: CreateRecipeInput!): Recipe!
    createRecipes(companyId: ID!, inputs: [CreateRecipeInput!]!): [Recipe!]!
    updateRecipe(id: ID!, input: CreateRecipeInput!): Recipe!
    deleteRecipe(id: ID!): Boolean!

    # Inventory
    createInventoryItem(companyId: ID!, input: CreateInventoryItemInput!): InventoryItem!
    updateInventoryItem(id: ID!, input: UpdateInventoryItemInput!): InventoryItem!
    deleteInventoryItem(id: ID!): Boolean!
    clearInventory(companyId: ID!): Boolean!
    savePosMappings(companyId: ID!, mappings: [PosMappingInput!]!): Boolean!

    # Event inventory
    updateEventInventory(eventId: ID!, inventoryItemId: ID!, quantityLoaded: Float!): EventInventory!
    restockEventInventory(eventId: ID!, eventInventoryId: ID!, quantity: Float!): EventInventory!

    # Inventory alerts
    markAlertRead(id: ID!): Boolean!
    markAllAlertsRead(companyId: ID!): Boolean!

    # Super Admin
    updateCompanyPlan(companyId: ID!, plan: String!): Company!
    setSuperAdmin(userId: ID!, isSuperAdmin: Boolean!): Boolean!

    # User prefs
    updateUserPrefs(prefs: JSON!): Boolean!
  }
`;
