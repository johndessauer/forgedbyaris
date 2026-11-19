// assets/js/property-search-paging.js
//
// Paging for Property Search. Each page is its own PropertyRadar Purchase=1
// of PAGE_SIZE records (Start is the offset). A second click while a page
// is in flight must not start another purchase. Load More appends the next
// window and drops ids already on screen. Clear Search bumps the generation
// so a response that arrives later cannot refill the list.
//
// No DOM and no fetch. property-search.html applies the result to the page.
// Node tests require() this file.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ForgePropertySearchPaging = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PAGE_SIZE = 25;

  function createState() {
    return {
      location: '',
      plays: [],
      propertyTypes: [],
      propertyMode: 'include',
      match: 'all',
      equityMin: '',
      equityMax: '',
      start: 0,
      total: 0,
      ids: [],
      loading: false,
      exhausted: false,
      generation: 0,
    };
  }

  function normalizeFilters(filters) {
    var f = filters || {};
    return {
      propertyTypes: (f.propertyTypes || []).slice(),
      propertyMode: f.propertyMode === 'exclude' ? 'exclude' : 'include',
      match: f.match === 'any' ? 'any' : 'all',
      equityMin: f.equityMin == null ? '' : String(f.equityMin),
      equityMax: f.equityMax == null ? '' : String(f.equityMax),
    };
  }

  function sameFilters(a, b) {
    return a.propertyMode === b.propertyMode && a.match === b.match &&
      a.equityMin === b.equityMin && a.equityMax === b.equityMax &&
      samePlays(a.propertyTypes, b.propertyTypes);
  }

  function samePlays(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function hasMore(state) {
    return !state.exhausted && state.total > state.start && state.ids.length > 0;
  }

  // First page of a search. A repeat click of the same search while that
  // first page is still in flight is ignored. A different location or lead
  // list starts a new generation so the older response is discarded.
  function beginNewSearch(state, location, plays, filters) {
    var nextPlays = (plays || []).slice();
    var nextFilters = normalizeFilters(filters);
    var loc = location || '';
    if (state.loading && state.ids.length === 0 && state.start === 0 &&
        state.location === loc && samePlays(state.plays, nextPlays) &&
        sameFilters(state, nextFilters)) {
      return { ok: false, reason: 'in-flight', generation: state.generation, start: 0 };
    }
    state.generation += 1;
    state.location = loc;
    state.plays = nextPlays;
    state.propertyTypes = nextFilters.propertyTypes;
    state.propertyMode = nextFilters.propertyMode;
    state.match = nextFilters.match;
    state.equityMin = nextFilters.equityMin;
    state.equityMax = nextFilters.equityMax;
    state.start = 0;
    state.total = 0;
    state.ids = [];
    state.loading = true;
    state.exhausted = false;
    return { ok: true, generation: state.generation, start: 0 };
  }

  // Next page. Refuses when a purchase is already in flight or the list
  // has no further records, so a double click cannot bill twice.
  function beginLoadMore(state) {
    if (state.loading) {
      return { ok: false, reason: 'in-flight', generation: state.generation, start: state.start };
    }
    if (!hasMore(state)) {
      return { ok: false, reason: 'no-more', generation: state.generation, start: state.start };
    }
    state.loading = true;
    return { ok: true, generation: state.generation, start: state.start };
  }

  function rowId(row) {
    if (!row || row.id == null) return '';
    var id = String(row.id);
    return id ? id : '';
  }

  // Applies one PropertyRadar page. `total` is totalResultCount.
  // The offset advances by every record returned, including ones we drop
  // as duplicates, so the next Start skips that window. A page that adds
  // nothing (empty, or all ids already shown) ends the list.
  function applyPage(state, generation, results, total) {
    if (generation !== state.generation) return { stale: true, appended: [] };
    var list = Array.isArray(results) ? results : [];
    var seen = {};
    for (var s = 0; s < state.ids.length; s++) seen[state.ids[s]] = true;
    var appended = [];
    for (var i = 0; i < list.length; i++) {
      var id = rowId(list[i]);
      if (!id || seen[id]) continue;
      seen[id] = true;
      appended.push(list[i]);
    }
    state.start += list.length;
    if (!list.length) {
      state.exhausted = true;
      state.total = state.ids.length;
    } else if (!appended.length) {
      state.exhausted = true;
      var reportedDup = Number(total);
      if (Number.isFinite(reportedDup)) state.total = reportedDup;
    } else {
      state.exhausted = false;
      var reported = Number(total);
      state.total = Number.isFinite(reported) ? reported : state.start;
      for (var j = 0; j < appended.length; j++) state.ids.push(rowId(appended[j]));
    }
    state.loading = false;
    return { stale: false, appended: appended, hasMore: hasMore(state) };
  }

  function failPage(state, generation) {
    if (generation !== state.generation) return { stale: true };
    state.loading = false;
    return { stale: false, hasMore: hasMore(state) };
  }

  // Back to the empty search: no location, no lead types, no rows, no
  // next offset. In-flight responses from the previous generation are stale.
  function clearState(state) {
    state.generation += 1;
    state.location = '';
    state.plays = [];
    state.propertyTypes = [];
    state.propertyMode = 'include';
    state.match = 'all';
    state.equityMin = '';
    state.equityMax = '';
    state.start = 0;
    state.total = 0;
    state.ids = [];
    state.loading = false;
    state.exhausted = false;
    return state;
  }

  function searchQuery(state, start) {
    var q = '/api/property-search?action=search&location=' + encodeURIComponent(state.location || '') +
      '&plays=' + (state.plays || []).join(',') + '&start=' + String(start);
    if (state.propertyTypes && state.propertyTypes.length) {
      q += '&ptypes=' + state.propertyTypes.join(',');
      if (state.propertyMode === 'exclude') q += '&pmode=exclude';
    }
    if (state.match === 'any') q += '&match=any';
    if (state.equityMin) q += '&emin=' + encodeURIComponent(state.equityMin);
    if (state.equityMax) q += '&emax=' + encodeURIComponent(state.equityMax);
    return q;
  }

  return {
    PAGE_SIZE: PAGE_SIZE,
    createState: createState,
    hasMore: hasMore,
    beginNewSearch: beginNewSearch,
    beginLoadMore: beginLoadMore,
    applyPage: applyPage,
    failPage: failPage,
    clearState: clearState,
    searchQuery: searchQuery,
  };
}));
