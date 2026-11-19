// assets/js/lead-filters.js
//
// Lead-type and property-type catalog for Property Search, shared by the
// page and the property-search function. Criterion names stay on the server
// (netlify/functions/_Lib/lead-criteria.js). This file only has ids, labels,
// and the URL shape both sides already agree on.
//
// Node tests require() it. The page loads it as a plain script.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ForgeLeadFilters = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Ids are stable. Existing saves and links use prefore, absentee,
  // highequity, vacant, taxdelinquent, probate, and divorce.
  var LEAD_TYPES = [
    { id: 'absentee', label: 'Absentee Owners', color: '#9CA3AF' },
    { id: 'activeinvestor', label: 'Active Investor Owned', color: '#38BDF8', note: 'approx' },
    { id: 'listing', label: 'Active Listing', color: '#FBBF24' },
    { id: 'bored', label: 'Bored Investor', color: '#A3E635' },
    { id: 'cashbuyer', label: 'Cash Buyers', color: '#34D399' },
    { id: 'taxdelinquent', label: 'Delinquent Tax Activity', color: '#C89B3C' },
    { id: 'flipped', label: 'Flipped', color: '#FB7185' },
    { id: 'foreactivity', label: 'Foreclosure Activity', color: '#F97316' },
    { id: 'foreclosure', label: 'Foreclosures (Bank-Owned)', color: '#B91C1C' },
    { id: 'freeclear', label: 'Free & Clear', color: '#2DD4BF' },
    { id: 'highequity', label: 'High Equity', color: '#22c55e' },
    { id: 'longterm', label: 'Long-Term Owner', color: '#818CF8' },
    { id: 'lowequity', label: 'Low Equity', color: '#F59E0B' },
    { id: 'inherited', label: 'Potentially Inherited', color: '#A78BFA', note: 'approx' },
    { id: 'prefore', label: 'Pre-Foreclosures', color: '#E5484D' },
    { id: 'upsidedown', label: 'Upside Down', color: '#EF4444' },
    { id: 'vacant', label: 'Vacancy', color: '#60A5FA' },
    { id: 'zombie', label: 'Zombie Property', color: '#6EE7B7' },
    { id: 'probate', label: 'Probate', color: '#C4B5FD' },
    { id: 'divorce', label: 'Divorce', color: '#FF6B2B' },
  ];

  var PROPERTY_TYPES = [
    { id: 'sfr', label: 'Single Family' },
    { id: 'condo', label: 'Condo' },
    { id: 'townhome', label: 'Town Home' },
    { id: 'multifamily', label: 'Multi Family (2-4)' },
    { id: 'apartment', label: 'Apartment (5+)' },
    { id: 'land', label: 'Land' },
    { id: 'mobile', label: 'Mobile/Manufactured' },
    { id: 'other', label: 'Other' },
  ];

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function splitIds(value, list) {
    if (!value) return [];
    var seen = {};
    var out = [];
    String(value).split(',').forEach(function (part) {
      var id = part.trim();
      if (!id || seen[id] || !byId(list, id)) return;
      seen[id] = true;
      out.push(id);
    });
    return out;
  }

  // Reads property-search.html query params. Missing keys stay unset so a
  // normal visit still opens on the default lead type and market.
  function parsePropertySearchLink(search) {
    var raw = search || '';
    if (raw.charAt(0) === '?') raw = raw.slice(1);
    var params = new URLSearchParams(raw);
    return {
      hasLocation: params.has('location'),
      location: params.get('location') || '',
      hasPlays: params.has('plays'),
      plays: splitIds(params.get('plays'), LEAD_TYPES),
      hasTypes: params.has('ptypes'),
      propertyTypes: splitIds(params.get('ptypes'), PROPERTY_TYPES),
      propertyMode: params.get('pmode') === 'exclude' ? 'exclude' : 'include',
      match: params.get('match') === 'any' ? 'any' : 'all',
      hasEquityMin: params.has('emin'),
      equityMin: params.get('emin') || '',
      hasEquityMax: params.has('emax'),
      equityMax: params.get('emax') || '',
    };
  }

  function buildPropertySearchLink(filters) {
    var f = filters || {};
    var params = new URLSearchParams();
    if (f.location) params.set('location', f.location);
    if (f.plays && f.plays.length) params.set('plays', f.plays.join(','));
    if (f.propertyTypes && f.propertyTypes.length) params.set('ptypes', f.propertyTypes.join(','));
    if (f.propertyMode === 'exclude') params.set('pmode', 'exclude');
    if (f.match === 'any') params.set('match', 'any');
    if (f.equityMin != null && String(f.equityMin) !== '') params.set('emin', String(f.equityMin));
    if (f.equityMax != null && String(f.equityMax) !== '') params.set('emax', String(f.equityMax));
    var qs = params.toString();
    return '/property-search.html' + (qs ? '?' + qs : '');
  }

  return {
    LEAD_TYPES: LEAD_TYPES,
    PROPERTY_TYPES: PROPERTY_TYPES,
    leadById: function (id) { return byId(LEAD_TYPES, id); },
    propertyTypeById: function (id) { return byId(PROPERTY_TYPES, id); },
    parsePropertySearchLink: parsePropertySearchLink,
    buildPropertySearchLink: buildPropertySearchLink,
  };
}));
