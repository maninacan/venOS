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
    "Onboarding answer: 'square' | 'manual' (others reserved)."
    posSystem: String
    "Onboarding answer: 'pos' | 'other' | 'flat_rate'."
    laborMethod: String
    "For a pending company (from pendingCompanies): when the current user last reminded the owner; null otherwise."
    lastRemindedAt: String
    "Counts of records that would be permanently removed if this company is deleted."
    deletionStats: CompanyDeletionStats!
  }

  "Record counts shown in the delete-company confirmation (the deletion's blast radius)."
  type CompanyDeletionStats {
    events: Int!
    recipes: Int!
    inventory: Int!
    members: Int!
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

  "A single tax the POS actually applied (e.g. state, county, city)."
  type TaxLine {
    name: String!
    "Fractional rate, e.g. 0.0725 for 7.25%."
    rate: Float!
    "Amount collected for this tax."
    amount: Float!
  }

  type TaxInfo {
    stateRate: Float
    localRate: Float
    combinedRate: Float
    stateTax: Float
    localTax: Float
    taxCollected: Float
    rateSource: String
    "The POS-applied tax breakdown (name + rate + amount); present when rateSource is 'square'."
    lines: [TaxLine!]
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
    "Per-unit cost of goods (from the mapped recipe or inventory item)."
    unitCost: Float
    totalCost: Float
    "Gross revenue this item sold for (from the POS), when available."
    revenue: Float
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
    "Composed components (a base recipe, a modifier, or an inventory item) that also contribute to cost."
    components: [RecipeComponent!]!
  }

  type RecipeIngredient {
    id: ID!
    name: String!
    quantity: Float!
    unitCost: Float!
    unit: String
  }

  "A sub-recipe component: a reference to a base recipe, a mapped modifier, or an inventory item, with a quantity (negative = removal)."
  type RecipeComponent {
    id: ID!
    componentType: String!      # 'recipe' | 'modifier' | 'inventory'
    refRecipeId: ID
    refModifierId: ID
    refInventoryId: ID
    quantity: Float!
    "Display name of the referenced entity (resolved)."
    name: String
    "Resolved cost contribution of this component (resolved)."
    cost: Float
  }

  input CreateRecipeInput {
    name: String!
    ingredients: [RecipeIngredientInput!]!
    components: [RecipeComponentInput!]
  }

  input RecipeIngredientInput {
    name: String!
    quantity: Float!
    unitCost: Float!
    unit: String
  }

  input RecipeComponentInput {
    componentType: String!      # 'recipe' | 'modifier' | 'inventory'
    refRecipeId: ID
    refModifierId: ID
    refInventoryId: ID
    quantity: Float!
  }

  "A proposed line (ingredient) for an optimization before/after preview or apply."
  type RecipeLine { name: String!, quantity: Float!, unitCost: Float!, unit: String }
  input RecipeLineInput { name: String!, quantity: Float!, unitCost: Float!, unit: String }

  "An AI recipe-optimization recommendation: keep a distinct recipe, or restructure a 1-off variant into base + add-on."
  type RecipeOptimization {
    recipeId: ID!
    recipeName: String!
    kind: String!               # 'variant' | 'distinct'
    baseFamilyKey: String
    baseExistingRecipeId: ID
    baseNewName: String
    baseNewIngredients: [RecipeLine!]!
    addonKeepIngredients: [RecipeLine!]!
    addonModifierId: ID
    addonInventoryId: ID
    addonQuantity: Float!
    "Display helpers (resolved server-side)."
    baseName: String
    addonLabel: String
    beforeCost: Float
    afterCost: Float
    confidence: Float
    reason: String
  }

  "Accepted optimization to apply (subset of RecipeOptimization the client sends back)."
  input RecipeOptimizationInput {
    recipeId: ID!
    baseFamilyKey: String
    baseExistingRecipeId: ID
    baseNewName: String
    baseNewIngredients: [RecipeLineInput!]!
    addonKeepIngredients: [RecipeLineInput!]!
    addonModifierId: ID
    addonInventoryId: ID
    addonQuantity: Float!
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

  type PosModifierMapping {
    id: ID!
    posModifierId: String!
    posModifierName: String
    inventoryItemId: ID
    recipeId: ID
    "Amount of the inventory item used per drink; negative removes an ingredient (reduces COGS)."
    quantity: Float
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

  input PosModifierMappingInput {
    posSystem: String!
    posModifierId: String!
    posModifierName: String
    inventoryId: ID
    recipeId: ID
    "Amount of the inventory item used per drink; negative removes an ingredient (reduces COGS)."
    quantity: Float
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

  type PosModifierCatalogItem {
    posModifierId: String!
    posModifierName: String!
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

  "An AI-suggested mapping for one POS modifier — reviewed/accepted by the user before saving."
  type PosModifierMappingRecommendation {
    posModifierId: String!
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

  type CompanyCountryRow {
    id: ID!
    name: String!
    plan: String!
    eventCount: Int!
    memberCount: Int!
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
    posModifierCatalog(companyId: ID!): [PosModifierCatalogItem!]!

    events(companyId: ID!, filter: String, search: String, page: Int): [Event!]!
    event(id: ID!): Event
    eventReport(id: ID!): EventReport
    eventKpi(companyId: ID!): EventKpi!
    eventTrend(companyId: ID!): [EventTrend!]!

    employees(companyId: ID!): [Employee!]!

    recipes(companyId: ID!): [Recipe!]!
    "AI recommendations to simplify 1-off recipes into base + add-on. Read-only; nothing is persisted. recipeIds restricts scope (null = all)."
    recipeOptimizationRecommendations(companyId: ID!, recipeIds: [ID!]): [RecipeOptimization!]!

    inventory(companyId: ID!): [InventoryItem!]!
    inventoryAlerts(companyId: ID!): [InventoryAlert!]!
    lowStockItems(companyId: ID!): [InventoryItem!]!
    posMappings(companyId: ID!): [PosMapping!]!
    "AI-suggested POS→recipe/inventory mappings for the user to review (nothing is persisted). Pass posItemIds to restrict the AI to only those (unmapped) items."
    posMappingRecommendations(companyId: ID!, posItemIds: [String!]): [PosMappingRecommendation!]!
    posModifierMappings(companyId: ID!): [PosModifierMapping!]!
    "AI-suggested POS modifier→recipe/inventory mappings for the user to review (nothing is persisted). Pass posModifierIds to restrict the AI to only those (unmapped) modifiers."
    posModifierMappingRecommendations(companyId: ID!, posModifierIds: [String!]): [PosModifierMappingRecommendation!]!
    eventInventory(eventId: ID!): [EventInventory!]!

    adminUsers: [AdminUser!]!
    adminCompanies: [AdminCompanyDetail!]!
    adminDashboard: AdminDashboard!
    companiesInState(state: String!): [CompanyLocation!]!
    "Companies with events in a country (ISO 3166-1 alpha-2), ranked by event count."
    companiesInCountry(country: String!): [CompanyCountryRow!]!
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
    "Apply accepted recipe-optimization recommendations (creates bases as needed, restructures variants in place)."
    applyRecipeOptimizations(companyId: ID!, accepted: [RecipeOptimizationInput!]!): Boolean!

    # Inventory
    createInventoryItem(companyId: ID!, input: CreateInventoryItemInput!): InventoryItem!
    updateInventoryItem(id: ID!, input: UpdateInventoryItemInput!): InventoryItem!
    deleteInventoryItem(id: ID!): Boolean!
    clearInventory(companyId: ID!): Boolean!
    savePosMappings(companyId: ID!, mappings: [PosMappingInput!]!): Boolean!
    savePosModifierMappings(companyId: ID!, mappings: [PosModifierMappingInput!]!): Boolean!

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
