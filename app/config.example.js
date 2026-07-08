// B8-04: frontend API base URL configuration.
// Copy this file to config.js and load it BEFORE app.js / admin.js in the HTML, e.g.:
//   <script src="./config.js"></script>
//   <script src="./app.js"></script>
// The client and admin apps read window.GOATEDBUY_API_BASE_URL as their default API
// base URL. Users can still override it in the connect form at runtime. Keep separate
// config.js files per environment (staging vs production) so a rollback is just a
// static-asset swap.
window.GOATEDBUY_API_BASE_URL = "http://127.0.0.1:3000"; // staging: https://staging-api.goatedbuy.example  | prod: https://api.goatedbuy.com
