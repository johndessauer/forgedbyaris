// Apartment Confidential / Empire coaching path.
// education-data.js serves this only after a server-side membership check.
// Video ids stay out of education.html.
const EMPIRE_LESSONS = [
  { module: 1, title: "Why Apartments & Your Plan", lessons: [
      { n: 1, youtubeId: "St5NUR2RbLI", duration: "5:18", title: "Why Apartments: Your Tenants Pay the Mortgage",
        description: "Why John Dessauer chose apartments, the five reasons he keeps buying them, the difference between an investor and a landlord, and the four ways one building pays you: cash flow, appreciation, equity growth, and tax benefits. Plus the simple ROI math every apartment investor needs." },
      { n: 2, youtubeId: "fv5w8ssXuR0", duration: "4:51", title: "The 10-to-1 Multiplier: Small Changes, Big Apartment Value",
        description: "Flip, wholesale, or buy and hold? John Dessauer walks through his 20-unit buy-and-hold example line by line, then shows how raising rents to market and trimming waste adds about $24,000 of NOI and, at a 10% cap rate, about $240,000 of value. The 10-to-1 multiplier explained, with John's 2015 figures." },
      { n: 3, youtubeId: "U2a3ayw_mRM", duration: "4:17", title: "What's Your Number? Build Your Apartment Investing Plan",
        description: "Build your apartment investing plan the way John Dessauer's mentor made him: goals, involvement, timeline, needs versus wants, and net-worth targets. Then run John's What's Your Number exercise to see how many units would replace your income, and take inventory of your cash, credit, equity, and time." },
      { n: 4, youtubeId: "V88XRFAfWFg", duration: "4:37", title: "Class, Unit Mix and Occupancy: Pick the Right Apartment Building",
        description: "Choose the right apartment building: Class A through D, John Dessauer's B-or-C-in-an-A-or-B-neighborhood rule, ingress and egress, unit mix, occupancy versus the submarket, size, construction, and deferred maintenance. Finish by writing your one-page buying criteria." },
  ] },
  { module: 2, title: "Markets & Your Team", lessons: [
      { n: 5, youtubeId: "bMEfaOHMKZE", duration: "4:54", title: "Find Your Neighborhood and Market: The Path of Progress",
        description: "How John Dessauer chooses neighborhoods and markets for apartments: ten neighborhood factors, the path-of-progress map technique, seven market drivers, the traits of good apartment markets, and a fast research routine. Judge areas by economics and property data, never by who lives there." },
      { n: 6, youtubeId: "HBzEWruZYio", duration: "4:40", title: "Build Your Apartment Dream Team",
        description: "You don't have to be an expert at everything. John Dessauer's apartment dream team: agents and brokers, a real estate attorney, a multifamily inspector, loan officers and mortgage brokers, an insurance agent, a real-estate CPA, a property manager, and a coach, plus how to vet each one and keep them organized." },
      { n: 7, youtubeId: "NCvMDyP85uU", duration: "4:29", title: "Hire and Manage Your Property Manager Like a Pro",
        description: "Be an investor, not a landlord. John Dessauer's property-management playbook: why he prefers larger firms, the questions to ask, secret-shopping their properties, the contract terms he always changes, the monthly owner package, and the weekly report and call that keep leasing, collections, and spending on track." },
  ] },
  { module: 3, title: "Find & Analyze Deals", lessons: [
      { n: 8, youtubeId: "WweesQTg4eQ", duration: "4:26", title: "Where the Apartment Deals Hide",
        description: "Where apartment deals hide: brokers, investor clubs, online listings, owners advertising units for rent, attorneys, courthouse hold-period searches, lenders, FSBOs, driving for dollars, and John Dessauer's most overlooked source, property managers. Plus the follow-up habit and property checklist that turn leads into deals." },
      { n: 9, youtubeId: "Fxq5flSX1ZM", duration: "4:07", title: "Direct Mail That Gets Apartment Owners Calling",
        description: "John Dessauer's direct mail system for reaching apartment owners: buying a current list or pulling owners free from appraisal districts, writing a personal, low-key, honest letter, the ten envelope-and-letter details that raise his response rate, and how to track every mailing so you keep only what works." },
      { n: 10, youtubeId: "y-PENNhM-bk", duration: "4:22", title: "NOI and Cap Rate: Never Buy Someone Else's Fantasy",
        description: "Value an apartment building the way John Dessauer does: comps and price per door as a check, then net operating income and cap rate, three ways. What moves cap rates, why you never buy someone else's proforma fantasy, how to annualize partial-year numbers, and John's 10-unit worked example." },
      { n: 11, youtubeId: "fAcoQMC-NVA", duration: "3:58", title: "Cash-on-Cash, DSCR, and Your Exit Plan",
        description: "John Dessauer's favorite return metric, cash-on-cash, plus the debt service coverage ratio lenders use, and the exit strategies that create your big payday: quick turn, forced appreciation, refinance (prime the pump), seller financing, 1031 exchange, condo conversion, and divide and conquer. Plan the exit the day you buy." },
  ] },
  { module: 4, title: "Offer, Negotiate, Verify", lessons: [
      { n: 12, youtubeId: "ecxqp24WyIw", duration: "4:00", title: "Letters of Intent and Purchase Agreements That Get Deals Done",
        description: "How John Dessauer makes offers on apartment buildings: offer forms for 2 to 6 units, simple non-binding letters of intent for larger properties, the two-option LOI, the practice-LOI drill, the must-have LOI terms, and turning an agreed LOI into a purchase and sale agreement with attorney review and a make-ready clause." },
      { n: 13, youtubeId: "HUA8C5RbJWk", duration: "4:17", title: "Negotiate Like a Pro: Bracketing, Strike Price, and the Nibble",
        description: "John Dessauer's negotiation playbook for apartment deals: know the other party, ask for more, keep a poker face, never take the first offer, bracket your counteroffers, start near 80% of asking or 10% under your strike price, never counter yourself, handle the nibble, work with brokers, and justify your price with comps and cap rates." },
      { n: 14, youtubeId: "FVOrDemag3U", duration: "4:21", title: "Due Diligence: Where Apartment Deals Live or Die",
        description: "John Dessauer's due diligence process for apartment buildings: assume everything is wrong until verified, start with the financials (bank statements versus books, monthly detail, rent roll and leases, utilities), then operational checks (contracts, property tax reassessment, insurance loss runs, survey, capital items, local laws, Phase I), and finally the physical inspection, repair credits, and terminating properly." },
  ] },
  { module: 5, title: "Fund, Fill & Scale", lessons: [
      { n: 15, youtubeId: "ru6QxZZPL6w", duration: "5:07", title: "Finance Your Apartments: Leverage, DSCR, and Creative Money",
        description: "Finance apartment deals the way John Dessauer does: the main loan types, how commercial underwriters judge DSCR, loan-to-value, loan-to-cost and tenant concentration, the power and risk of leverage, seller financing and seller seconds, private money, partners, bridge loans, recourse, and the closing details, including choosing an ownership entity with your CPA and attorney." },
      { n: 16, youtubeId: "KjW5tM3OEb4", duration: "4:24", title: "Add Value: Value Plays and New Income Streams",
        description: "John Dessauer's value-add playbook: drill into submarket stats (price per door, concessions, current versus asking rents), spot the five value plays, add income from covered parking, trash valet, cable and internet agreements, laundry, and vending, never pay a seller for your own upside, and know what moves values up or down. Includes John's 52-unit Rensselaer, Indiana example." },
      { n: 17, youtubeId: "6L2ZrkLdIPI", duration: "4:49", title: "Fill Your Units: Apartment Marketing and Fair Housing",
        description: "Keep your apartments full and stay compliant. John Dessauer's always-on marketing programs (flyers, resident referrals, signage, voucher programs, online listings and a property website, rent locators), tracking every lead to its source, Fair Housing rules for advertising and screening, retention, and lawful collections, with evictions only through the courts." },
      { n: 18, youtubeId: "_35ACUu2NVo", duration: "4:17", title: "Build Your Empire: Investors, Partners, and Your Next Three Steps",
        description: "Build your apartment empire: run it like a real business with an entity, logo, domain email, and professional phone habits; raise private capital and syndicate with an SEC attorney; use self-directed IRAs with a qualified custodian and your CPA; choose partners carefully; then John Dessauer's three steps (set a goal, educate yourself daily, take action) and why top performers use coaches." },
  ] },
];

module.exports = { EMPIRE_LESSONS };
