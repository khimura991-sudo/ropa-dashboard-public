// ROPA Dashboard (public version, no sign-in).
window.ROPA_CONFIG = {
  // Published Google Sheet link: File > Share > Publish to web > the "data" tab > Comma-separated values (.csv).
  // Leave empty ("") to read data.json from this folder instead.
  sheetCsvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vT_5bFQS0Ehy7LnLHnVKdv_iPNSYOdz47Su_H4f0NRC-aR5dX8SZhXMm3-ouTXzMOR2UMWP33gSbCV4/pub?gid=0&single=true&output=csv",
  dataFile: "data.json",
  recoveryTarget: 0.83,
  inventoryTarget: 360,
  // How often an open page re-reads the data (minutes). 0 turns it off.
  autoRefreshMinutes: 5,
};
