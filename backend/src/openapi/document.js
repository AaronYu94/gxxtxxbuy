export function createOpenApiDocument(env = {}) {
  const serviceName = env.serviceName || "goatedbuy-backend";
  const version = env.appVersion || "0.1.0";

  return {
    openapi: "3.1.0",
    info: {
      title: "GOATEDBUY Backend API",
      version,
      description: "Production backend API foundation for GOATEDBUY."
    },
    servers: [
      {
        url: "http://127.0.0.1:3000",
        description: "Local development"
      },
      {
        url: "https://staging-api.goatedbuy.example",
        description: "Staging placeholder"
      }
    ],
    tags: [
      {
        name: "System",
        description: "Service health, readiness, and release metadata."
      },
      {
        name: "Auth",
        description: "Client user registration, login, session refresh, and profile."
      },
      {
        name: "Admin Auth",
        description: "Admin authentication and RBAC-backed identity."
      },
      {
        name: "Admin Console",
        description: "Permission-scoped admin overview, queues, status changes, parcels, and policy CMS."
      },
      {
        name: "Client Core",
        description: "Saved links, haul items, purchase orders, and Trust Center policies."
      },
      {
        name: "Catalog",
        description: "Link parsing, immutable product snapshots, and payable-price calculation (V2-03)."
      },
      {
        name: "Orders",
        description: "Parent orders and item sub-orders — creation, retrieval, and listing (V2-04)."
      },
      {
        name: "Procurement",
        description: "Purchase platform accounts and post-payment assignment (V2-04)."
      },
      {
        name: "Wallet (V2)",
        description: "CNY wallet balance and double-entry ledger transactions (V2-05)."
      },
      {
        name: "Warehouse (V2)",
        description: "Inbound scanning, measurement, QC, locations, and storage (V2-06)."
      },
      {
        name: "Logistics (V2)",
        description: "Carriers, routes, versioned prices, freight quotes, parcels, and batches (V2-07)."
      },
      {
        name: "Consolidation (V2)",
        description: "Value-added services, eligible stock, and draft parcels with reservation (V2-07)."
      },
      {
        name: "Outbound (V2)",
        description: "Outbound batches, handoff with tracking writeback, and tracking sync (V2-07)."
      },
      {
        name: "After-Sales (V2)",
        description: "Returns & refunds: eligibility, request, review, refund chain (V2-08)."
      },
      {
        name: "User Admin (V2)",
        description: "Restricted user search, role-tailored detail, CS-assisted edit (V2-09)."
      },
      {
        name: "Membership (V2)",
        description: "Membership tier config, growth-value ledger, membership center (V2-09)."
      },
      {
        name: "Account Risk (V2)",
        description: "Account risk events, finance-initiated lock, super-admin approval (V2-09)."
      },
      {
        name: "Coupons (V2)",
        description: "International-shipping coupons: create, grant, redeem, reserve, settle (V2-10)."
      },
      {
        name: "Banners (V2)",
        description: "Homepage carousel banners: targeted, scheduled, device-resolved (V2-10)."
      },
      {
        name: "CMS (V2)",
        description: "Multilingual email templates + agreement/announcement/config versions (V2-10)."
      },
      {
        name: "Email Campaigns (V2)",
        description: "Promotional email campaigns: audience snapshot, batches, stats (V2-10)."
      },
      {
        name: "Support (V2)",
        description: "Customer support conversations: inbound auto-link, claim, reply, metrics (V2-10)."
      },
      {
        name: "Notifications (V2)",
        description: "Unified notification + scheduled-task catalog, idempotent dispatch, dead-letters (V2-10)."
      },
      {
        name: "Referral (V2)",
        description: "Invitation relationships, referral codes/links/QR, signup binding (V2-11)."
      },
      {
        name: "Commission (V2)",
        description: "Isolated commission wallet ledger + signed-parcel commission (V2-11)."
      },
      {
        name: "Infra (V2)",
        description: "Job dead-letter governance, replay, and health signals (V2-12)."
      },
      {
        name: "Warehouse / QC",
        description: "Warehouse receiving, item weights, QC photos, storage status, and user QC decisions."
      },
      {
        name: "Shipping",
        description: "Shipping lines, parcels, quotes, payments, tracking, and admin shipment status."
      },
      {
        name: "Wallet / Coupons",
        description: "Wallet balance, coupon redemption, Welcome Gift, checkout coupon locks, and finance adjustments."
      },
      {
        name: "Creators",
        description: "Creator attribution touches, creator dashboard, and admin creator/campaign management."
      },
      {
        name: "Content",
        description: "User Haul Stories and the admin content moderation queue and actions."
      },
      {
        name: "Risk",
        description: "Risk case console: list, open, and update cases with legal status transitions."
      },
      {
        name: "Country Shipping",
        description: "Public country shipping hub and admin country rule versioning."
      }
    ],
    paths: {
      "/auth/register": {
        post: {
          tags: ["Auth"],
          summary: "Register a client user",
          operationId: "registerUser",
          requestBody: jsonRequest("RegisterRequest"),
          responses: {
            201: jsonResponse("User registered; email verification required.", "RegistrationResponse"),
            400: errorResponse("Invalid registration input."),
            409: errorResponse("Email already registered.")
          }
        }
      },
      "/auth/oauth/providers": {
        get: { tags: ["Authentication"], summary: "List available social-login providers", operationId: "listOAuthProviders", responses: { 200: okResponse("Providers.") } }
      },
      "/auth/oauth/{provider}/start": {
        get: { tags: ["Authentication"], summary: "Begin social login (redirect to provider)", operationId: "startOAuth", parameters: [pathParameter("provider"), queryParameter("return_to")], responses: { 302: okResponse("Redirect."), 404: errorResponse("Unknown provider."), 409: errorResponse("Not configured.") } }
      },
      "/auth/oauth/{provider}/callback": {
        get: { tags: ["Authentication"], summary: "Social login callback → session", operationId: "oauthCallback", parameters: [pathParameter("provider"), queryParameter("code"), queryParameter("state")], responses: { 200: okResponse("Session."), 400: errorResponse("Bad state / code.") } },
        post: { tags: ["Authentication"], summary: "Social login callback (form_post) → session", operationId: "oauthCallbackPost", parameters: [pathParameter("provider")], requestBody: genericRequest(), responses: { 200: okResponse("Session."), 400: errorResponse("Bad state / code.") } }
      },
      "/api/v2/account/linked-providers": {
        get: { tags: ["Authentication"], summary: "My linked social providers", operationId: "listLinkedProviders", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Providers.") } }
      },
      "/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Login a client user",
          operationId: "loginUser",
          requestBody: jsonRequest("LoginRequest"),
          responses: {
            200: jsonResponse("User logged in.", "AuthResponse"),
            401: errorResponse("Invalid credentials.")
          }
        }
      },
      "/auth/verify-email": {
        post: {
          tags: ["Auth"], summary: "Verify a registration email", operationId: "verifyRegistrationEmail",
          requestBody: jsonRequest("TokenRequest"),
          responses: { 200: jsonResponse("Email verified.", "VerificationResponse"), 400: errorResponse("Token invalid or expired."), 409: errorResponse("Token already consumed.") }
        }
      },
      "/auth/resend-verification": {
        post: {
          tags: ["Auth"], summary: "Resend registration verification", operationId: "resendRegistrationVerification",
          requestBody: jsonRequest("EmailRequest"),
          responses: { 202: jsonResponse("Request accepted.", "VerificationAcceptedResponse"), 429: errorResponse("Resend rate limited.") }
        }
      },
      "/auth/verify-device": {
        post: {
          tags: ["Auth"], summary: "Verify a new or stale device", operationId: "verifyLoginDevice",
          requestBody: jsonRequest("TokenRequest"),
          responses: { 200: jsonResponse("Device trusted and session created.", "AuthResponse"), 400: errorResponse("Token invalid or expired."), 409: errorResponse("Token already consumed.") }
        }
      },
      "/auth/refresh": {
        post: {
          tags: ["Auth"],
          summary: "Refresh a client user session",
          operationId: "refreshUserSession",
          requestBody: jsonRequest("RefreshRequest"),
          responses: {
            200: jsonResponse("User session refreshed.", "AuthResponse"),
            401: errorResponse("Refresh token invalid or expired.")
          }
        }
      },
      "/auth/logout": {
        post: {
          tags: ["Auth"],
          summary: "Revoke a client user session",
          operationId: "logoutUser",
          security: [{ bearerAuth: [] }],
          responses: {
            204: { description: "Session revoked." },
            401: errorResponse("Bearer token missing or invalid.")
          }
        }
      },
      "/me": {
        get: {
          tags: ["Auth"],
          summary: "Get current client user",
          operationId: "getMe",
          security: [{ bearerAuth: [] }],
          responses: {
            200: jsonResponse("Current user.", "MeResponse"),
            401: errorResponse("Bearer token missing or invalid.")
          }
        }
      },
      "/api/v2/account": {
        get: {
          tags: ["Auth"], summary: "Get versioned account settings", operationId: "getV2Account",
          security: [{ bearerAuth: [] }],
          responses: { 200: jsonResponse("Account settings.", "V2AccountEnvelope"), 401: errorResponse("Authentication required.") }
        },
        patch: {
          tags: ["Auth"], summary: "Update account settings", operationId: "updateV2Account",
          security: [{ bearerAuth: [] }], requestBody: jsonRequest("V2AccountUpdateRequest"),
          responses: { 200: jsonResponse("Account updated.", "V2AccountEnvelope"), 409: errorResponse("Account version conflict.") }
        }
      },
      "/api/v2/account/password": {
        post: {
          tags: ["Auth"], summary: "Change password and revoke all sessions", operationId: "changeV2AccountPassword",
          security: [{ bearerAuth: [] }], requestBody: jsonRequest("V2PasswordChangeRequest"),
          responses: { 200: jsonResponse("Password changed and sessions revoked.", "V2ActionEnvelope"), 401: errorResponse("Current password invalid."), 409: errorResponse("Account version conflict.") }
        }
      },
      "/api/v2/addresses": {
        get: {
          tags: ["Auth"], summary: "List the current user's addresses", operationId: "listV2Addresses",
          security: [{ bearerAuth: [] }], responses: { 200: jsonResponse("Address list.", "V2AddressListEnvelope") }
        },
        post: {
          tags: ["Auth"], summary: "Create an address", operationId: "createV2Address",
          security: [{ bearerAuth: [] }], requestBody: jsonRequest("V2AddressWriteRequest"),
          responses: { 201: jsonResponse("Address created.", "V2AddressEnvelope"), 400: errorResponse("Invalid address.") }
        }
      },
      "/api/v2/addresses/{addressId}": {
        patch: {
          tags: ["Auth"], summary: "Update an owned address", operationId: "updateV2Address",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("addressId")], requestBody: jsonRequest("V2AddressUpdateRequest"),
          responses: { 200: jsonResponse("Address updated.", "V2AddressEnvelope"), 404: errorResponse("Address not found."), 409: errorResponse("Address version conflict.") }
        },
        delete: {
          tags: ["Auth"], summary: "Soft-delete an owned address", operationId: "deleteV2Address",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("addressId"), headerParameter("If-Match")],
          responses: { 200: jsonResponse("Address deleted.", "V2ActionEnvelope"), 404: errorResponse("Address not found."), 409: errorResponse("Address version conflict.") }
        }
      },
      "/api/v2/account/deletion-eligibility": {
        get: {
          tags: ["Auth"], summary: "Check account deletion eligibility", operationId: "getV2DeletionEligibility",
          security: [{ bearerAuth: [] }], responses: { 200: jsonResponse("Deletion eligibility.", "V2DeletionEligibilityEnvelope") }
        }
      },
      "/api/v2/account/deletion-requests": {
        post: {
          tags: ["Auth"], summary: "Queue asynchronous account anonymization", operationId: "createV2DeletionRequest",
          security: [{ bearerAuth: [] }],
          responses: { 202: jsonResponse("Deletion queued and sessions revoked.", "V2DeletionRequestEnvelope"), 422: errorResponse("Account obligations block deletion.") }
        }
      },
      "/admin/auth/login": {
        post: {
          tags: ["Admin Auth"],
          summary: "Login an admin user",
          operationId: "loginAdmin",
          requestBody: jsonRequest("LoginRequest"),
          responses: {
            200: jsonResponse("Password accepted; MFA challenge created.", "AdminChallengeResponse"),
            401: errorResponse("Invalid credentials.")
          }
        }
      },
      "/admin/auth/totp/setup": {
        post: {
          tags: ["Admin Auth"], summary: "Begin mandatory TOTP setup", operationId: "beginAdminTotpSetup",
          requestBody: jsonRequest("AdminChallengeRequest"),
          responses: { 200: jsonResponse("TOTP secret created.", "TotpSetupResponse"), 401: errorResponse("Challenge invalid or expired.") }
        }
      },
      "/admin/auth/totp/confirm": {
        post: {
          tags: ["Admin Auth"], summary: "Confirm TOTP setup and create session", operationId: "confirmAdminTotpSetup",
          requestBody: jsonRequest("AdminTotpRequest"),
          responses: { 200: jsonResponse("TOTP enabled and session created.", "AdminAuthResponse"), 401: errorResponse("Code invalid.") }
        }
      },
      "/admin/auth/verify-totp": {
        post: {
          tags: ["Admin Auth"], summary: "Complete admin MFA login", operationId: "verifyAdminTotp",
          requestBody: jsonRequest("AdminTotpRequest"),
          responses: { 200: jsonResponse("Admin session created.", "AdminAuthResponse"), 401: errorResponse("Challenge or code invalid.") }
        }
      },
      "/admin/auth/reauth": {
        post: {
          tags: ["Admin Auth"], summary: "Create a fresh high-risk re-authentication proof", operationId: "createAdminReauth",
          security: [{ bearerAuth: [] }], requestBody: jsonRequest("AdminReauthRequest"),
          responses: { 200: jsonResponse("One-time re-authentication proof created.", "AdminReauthResponse"), 401: errorResponse("Session or code invalid.") }
        }
      },
      "/admin/security/users/{adminUserId}/disable": {
        post: {
          tags: ["Admin Auth"], summary: "Disable an employee and revoke sessions", operationId: "disableAdminUser",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("adminUserId")],
          responses: { 200: jsonResponse("Employee disabled.", "AdminMeResponse"), 401: errorResponse("Authentication required."), 403: errorResponse("Permission or re-authentication missing.") }
        }
      },
      "/admin/security/users/{adminUserId}/role": {
        post: {
          tags: ["Admin Auth"], summary: "Assign the employee's single role", operationId: "assignAdminRole",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("adminUserId")], requestBody: jsonRequest("AdminRoleRequest"),
          responses: { 201: jsonResponse("Role assigned.", "AdminRoleResponse"), 409: errorResponse("Employee already has a role.") }
        }
      },
      "/admin/auth/refresh": {
        post: {
          tags: ["Admin Auth"],
          summary: "Refresh an admin session",
          operationId: "refreshAdminSession",
          requestBody: jsonRequest("RefreshRequest"),
          responses: {
            200: jsonResponse("Admin session refreshed.", "AdminAuthResponse"),
            401: errorResponse("Refresh token invalid or expired.")
          }
        }
      },
      "/admin/auth/logout": {
        post: {
          tags: ["Admin Auth"],
          summary: "Revoke an admin session",
          operationId: "logoutAdmin",
          security: [{ bearerAuth: [] }],
          responses: {
            204: { description: "Session revoked." },
            401: errorResponse("Bearer token missing or invalid.")
          }
        }
      },
      "/admin/me": {
        get: {
          tags: ["Admin Auth"],
          summary: "Get current admin user and permissions",
          operationId: "getAdminMe",
          security: [{ bearerAuth: [] }],
          responses: {
            200: jsonResponse("Current admin user.", "AdminMeResponse"),
            401: errorResponse("Bearer token missing or invalid.")
          }
        }
      },
      "/admin/overview": {
        get: {
          tags: ["Admin Console"],
          summary: "Get permission-scoped admin overview counts",
          operationId: "getAdminOverview",
          security: [{ bearerAuth: [] }],
          responses: {
            200: jsonResponse("Visible admin overview counts.", "AdminOverviewResponse"),
            401: errorResponse("Admin bearer token missing or invalid.")
          }
        }
      },
      "/admin/orders": {
        get: {
          tags: ["Admin Console"],
          summary: "List purchase orders for admin queues",
          operationId: "listAdminOrders",
          security: [{ bearerAuth: [] }],
          parameters: [
            queryParameter("status"),
            queryParameter("limit", { type: "integer", minimum: 1, maximum: 100 }),
            queryParameter("offset", { type: "integer", minimum: 0 })
          ],
          responses: {
            200: jsonResponse("Admin order queue.", "AdminOrdersResponse"),
            400: errorResponse("Invalid order filter."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks order read permission.")
          }
        }
      },
      "/admin/orders/{id}/status": {
        patch: {
          tags: ["Admin Console"],
          summary: "Update purchase order status",
          operationId: "updateAdminOrderStatus",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("id")],
          requestBody: jsonRequest("AdminOrderStatusRequest"),
          responses: {
            200: jsonResponse("Admin order status updated.", "AdminOrderEnvelope"),
            400: errorResponse("Invalid status input."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks order write permission."),
            404: errorResponse("Order not found."),
            409: errorResponse("Illegal order status transition.")
          }
        }
      },
      "/admin/orders/{id}/exception": {
        patch: {
          tags: ["Admin Console"],
          summary: "Mark or update a purchase order exception",
          operationId: "updateAdminOrderException",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("id")],
          requestBody: jsonRequest("AdminOrderExceptionRequest"),
          responses: {
            200: jsonResponse("Admin order exception updated.", "AdminOrderEnvelope"),
            400: errorResponse("Exception reason is missing or invalid."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks order or support write permission."),
            404: errorResponse("Order not found.")
          }
        }
      },
      "/admin/warehouse/items": {
        get: {
          tags: ["Admin Console"],
          summary: "List warehouse items for admin queues",
          operationId: "listAdminWarehouseItems",
          security: [{ bearerAuth: [] }],
          parameters: [
            queryParameter("status"),
            queryParameter("limit", { type: "integer", minimum: 1, maximum: 100 }),
            queryParameter("offset", { type: "integer", minimum: 0 })
          ],
          responses: {
            200: jsonResponse("Admin warehouse queue.", "AdminWarehouseItemsResponse"),
            400: errorResponse("Invalid warehouse filter."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks warehouse read permission.")
          }
        }
      },
      "/admin/parcels": {
        get: {
          tags: ["Admin Console"],
          summary: "List parcels for admin queues",
          operationId: "listAdminParcels",
          security: [{ bearerAuth: [] }],
          parameters: [
            queryParameter("status"),
            queryParameter("limit", { type: "integer", minimum: 1, maximum: 100 }),
            queryParameter("offset", { type: "integer", minimum: 0 })
          ],
          responses: {
            200: jsonResponse("Admin parcel queue.", "AdminParcelsResponse"),
            400: errorResponse("Invalid parcel filter."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks shipping or support read permission.")
          }
        }
      },
      "/admin/policies": {
        get: {
          tags: ["Admin Console"],
          summary: "List policy CMS pages",
          operationId: "listAdminPolicies",
          security: [{ bearerAuth: [] }],
          parameters: [
            queryParameter("status"),
            queryParameter("limit", { type: "integer", minimum: 1, maximum: 100 }),
            queryParameter("offset", { type: "integer", minimum: 0 })
          ],
          responses: {
            200: jsonResponse("Admin policy CMS pages.", "AdminPoliciesResponse"),
            400: errorResponse("Invalid policy filter."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks policy CMS permission.")
          }
        }
      },
      "/admin/policies/{id}": {
        patch: {
          tags: ["Admin Console"],
          summary: "Update a policy CMS page",
          operationId: "updateAdminPolicy",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("id")],
          requestBody: jsonRequest("AdminPolicyPatchRequest"),
          responses: {
            200: jsonResponse("Admin policy updated.", "AdminPolicyEnvelope"),
            400: errorResponse("Invalid policy update input."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks policy CMS permission."),
            404: errorResponse("Policy not found.")
          }
        }
      },
      "/links": {
        get: {
          tags: ["Client Core"],
          summary: "List saved product links",
          operationId: "listSavedLinks",
          security: [{ bearerAuth: [] }],
          responses: {
            200: jsonResponse("Saved links.", "SavedLinksResponse"),
            401: errorResponse("Bearer token missing or invalid.")
          }
        },
        post: {
          tags: ["Client Core"],
          summary: "Save a product link",
          operationId: "saveLink",
          security: [{ bearerAuth: [] }],
          requestBody: jsonRequest("SaveLinkRequest"),
          responses: {
            201: jsonResponse("Saved link created.", "SavedLinkEnvelope"),
            200: jsonResponse("Saved link already exists.", "SavedLinkEnvelope"),
            400: errorResponse("Invalid URL."),
            401: errorResponse("Bearer token missing or invalid.")
          }
        }
      },
      "/links/{id}": {
        patch: {
          tags: ["Client Core"],
          summary: "Update saved link details",
          operationId: "updateSavedLink",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("id")],
          requestBody: jsonRequest("UpdateLinkRequest"),
          responses: {
            200: jsonResponse("Saved link updated.", "SavedLinkEnvelope"),
            400: errorResponse("Invalid link details."),
            401: errorResponse("Bearer token missing or invalid."),
            404: errorResponse("Saved link not found.")
          }
        }
      },
      "/links/{id}/parse": {
        post: {
          tags: ["Client Core"],
          summary: "Queue saved link parsing",
          operationId: "parseSavedLink",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("id")],
          responses: {
            202: jsonResponse("Parse task accepted or failed safely.", "ParseLinkResponse"),
            401: errorResponse("Bearer token missing or invalid."),
            404: errorResponse("Saved link not found.")
          }
        }
      },
      "/links/{id}/add-to-haul": {
        post: {
          tags: ["Client Core"],
          summary: "Add a saved link to My Haul",
          operationId: "addLinkToHaul",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("id")],
          requestBody: jsonRequest("UpdateLinkRequest"),
          responses: {
            201: jsonResponse("Haul item created.", "HaulItemEnvelope"),
            200: jsonResponse("Haul item already exists.", "HaulItemEnvelope"),
            400: errorResponse("Missing required item details."),
            401: errorResponse("Bearer token missing or invalid."),
            404: errorResponse("Saved link not found.")
          }
        }
      },
      "/haul-items": {
        get: {
          tags: ["Client Core"],
          summary: "List My Haul items",
          operationId: "listHaulItems",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "status",
              in: "query",
              required: false,
              schema: { type: "string" }
            }
          ],
          responses: {
            200: jsonResponse("Haul items.", "HaulItemsResponse"),
            400: errorResponse("Invalid status filter."),
            401: errorResponse("Bearer token missing or invalid.")
          }
        }
      },
      "/purchase-orders": {
        post: {
          tags: ["Client Core"],
          summary: "Submit a purchase order",
          operationId: "submitPurchaseOrder",
          security: [{ bearerAuth: [] }],
          requestBody: jsonRequest("PurchaseOrderRequest"),
          responses: {
            201: jsonResponse("Purchase order submitted.", "PurchaseOrderEnvelope"),
            200: jsonResponse("Purchase order already exists.", "PurchaseOrderEnvelope"),
            400: errorResponse("Invalid purchase order input."),
            401: errorResponse("Bearer token missing or invalid."),
            404: errorResponse("Haul item not found."),
            409: errorResponse("Haul item status does not allow purchase submission.")
          }
        }
      },
      "/orders": {
        get: {
          tags: ["Client Core"],
          summary: "List purchase orders",
          operationId: "listOrders",
          security: [{ bearerAuth: [] }],
          responses: {
            200: jsonResponse("Purchase orders.", "OrdersResponse"),
            401: errorResponse("Bearer token missing or invalid.")
          }
        }
      },
      "/orders/{id}": {
        get: {
          tags: ["Client Core"],
          summary: "Get purchase order details",
          operationId: "getOrder",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("id")],
          responses: {
            200: jsonResponse("Purchase order detail.", "PurchaseOrderEnvelope"),
            401: errorResponse("Bearer token missing or invalid."),
            404: errorResponse("Order not found.")
          }
        }
      },
      "/admin/warehouse/items/{id}/receive": {
        post: {
          tags: ["Warehouse / QC"],
          summary: "Receive a purchased item into the warehouse",
          operationId: "receiveWarehouseItem",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("id")],
          requestBody: jsonRequest("WarehouseReceiveRequest"),
          responses: {
            201: jsonResponse("Warehouse item received.", "WarehouseItemEnvelope"),
            200: jsonResponse("Warehouse item was already received.", "WarehouseItemEnvelope"),
            400: errorResponse("Invalid receive input."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks warehouse write permission."),
            404: errorResponse("Purchase order or haul item not found.")
          }
        }
      },
      "/admin/warehouse/items/{id}/weight": {
        patch: {
          tags: ["Warehouse / QC"],
          summary: "Update a warehouse item weight",
          operationId: "updateWarehouseItemWeight",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("id")],
          requestBody: jsonRequest("WarehouseWeightRequest"),
          responses: {
            200: jsonResponse("Warehouse item weight updated.", "WarehouseItemEnvelope"),
            400: errorResponse("Invalid weight input."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks warehouse write permission."),
            404: errorResponse("Warehouse item not found.")
          }
        }
      },
      "/admin/qc/items/{id}/photos": {
        post: {
          tags: ["Warehouse / QC"],
          summary: "Upload 3-5 QC photos for a warehouse item",
          operationId: "uploadQcPhotos",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("id")],
          requestBody: jsonRequest("QcPhotoUploadRequest"),
          responses: {
            201: jsonResponse("QC photos uploaded.", "QcPhotoUploadResponse"),
            200: jsonResponse("QC photos already exist.", "QcPhotoUploadResponse"),
            400: errorResponse("Invalid QC photo input."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks warehouse write permission."),
            404: errorResponse("Warehouse item not found.")
          }
        }
      },
      "/qc/items": {
        get: {
          tags: ["Warehouse / QC"],
          summary: "List the current user's warehouse QC items",
          operationId: "listUserQcItems",
          security: [{ bearerAuth: [] }],
          responses: {
            200: jsonResponse("QC items.", "QcItemsResponse"),
            401: errorResponse("Bearer token missing or invalid.")
          }
        }
      },
      "/qc/items/{id}/approve": {
        post: {
          tags: ["Warehouse / QC"],
          summary: "Approve QC for a warehouse item",
          operationId: "approveQc",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("id")],
          responses: {
            200: jsonResponse("QC approved.", "QcItemEnvelope"),
            401: errorResponse("Bearer token missing or invalid."),
            404: errorResponse("Warehouse item not found."),
            409: errorResponse("QC photos or weight are missing.")
          }
        }
      },
      "/qc/items/{id}/extra-photo": {
        post: {
          tags: ["Warehouse / QC"],
          summary: "Request an extra QC photo",
          operationId: "requestExtraQcPhoto",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("id")],
          requestBody: jsonRequest("ExtraPhotoRequestInput"),
          responses: {
            201: jsonResponse("Extra photo request created.", "ExtraPhotoRequestEnvelope"),
            200: jsonResponse("Open extra photo request already exists.", "ExtraPhotoRequestEnvelope"),
            401: errorResponse("Bearer token missing or invalid."),
            404: errorResponse("Warehouse item not found.")
          }
        }
      },
      "/warehouse/items/{id}/storage": {
        get: {
          tags: ["Warehouse / QC"],
          summary: "Get free storage status for a warehouse item",
          operationId: "getWarehouseItemStorageStatus",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("id")],
          responses: {
            200: jsonResponse("Warehouse storage status.", "StorageStatusEnvelope"),
            401: errorResponse("Bearer token missing or invalid."),
            404: errorResponse("Warehouse item not found.")
          }
        }
      },
      "/policies": {
        get: {
          tags: ["Client Core"],
          summary: "List published Trust Center policies",
          operationId: "listPolicies",
          responses: {
            200: jsonResponse("Published policies.", "PoliciesResponse")
          }
        }
      },
      "/api/v2/catalog/parse-jobs": {
        post: {
          tags: ["Catalog"], summary: "Submit a link for parsing", operationId: "submitCatalogParseJob",
          security: [{ bearerAuth: [] }], requestBody: jsonRequest("CatalogParseSubmitRequest"),
          responses: {
            201: jsonResponse("Parse job created.", "CatalogParseJobEnvelope"),
            200: jsonResponse("Existing job for a duplicate link.", "CatalogParseJobEnvelope"),
            400: errorResponse("Invalid URL.")
          }
        },
        get: {
          tags: ["Catalog"], summary: "List the current user's parse jobs", operationId: "listCatalogParseJobs",
          security: [{ bearerAuth: [] }], responses: { 200: jsonResponse("Parse jobs.", "CatalogParseJobListEnvelope") }
        }
      },
      "/api/v2/catalog/parse-jobs/{id}": {
        get: {
          tags: ["Catalog"], summary: "Get a parse job and its snapshot", operationId: "getCatalogParseJob",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")],
          responses: { 200: jsonResponse("Parse job detail.", "CatalogParseJobDetailEnvelope"), 404: errorResponse("Job not found.") }
        }
      },
      "/api/v2/catalog/parse-jobs/{id}/retry": {
        post: {
          tags: ["Catalog"], summary: "Retry a failed or manual parse job", operationId: "retryCatalogParseJob",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")],
          responses: { 202: jsonResponse("Retry queued.", "CatalogParseJobEnvelope"), 404: errorResponse("Job not found."), 409: errorResponse("Job already snapshotted.") }
        }
      },
      "/api/v2/catalog/parse-jobs/{id}/manual-fill": {
        post: {
          tags: ["Catalog"], summary: "Complete a degraded parse job manually", operationId: "manualFillCatalogParseJob",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: jsonRequest("CatalogManualFillRequest"),
          responses: { 201: jsonResponse("Manual snapshot created.", "CatalogParseJobDetailEnvelope"), 400: errorResponse("Invalid input."), 404: errorResponse("Job not found.") }
        }
      },
      "/api/v2/catalog/snapshots/{id}": {
        get: {
          tags: ["Catalog"], summary: "Get an owned immutable product snapshot", operationId: "getCatalogSnapshot",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")],
          responses: { 200: jsonResponse("Snapshot.", "CatalogSnapshotEnvelope"), 404: errorResponse("Snapshot not found.") }
        }
      },
      "/api/v2/catalog/price-calculations": {
        post: {
          tags: ["Catalog"], summary: "Calculate and persist a payable-price snapshot", operationId: "createCatalogPriceCalculation",
          security: [{ bearerAuth: [] }], requestBody: jsonRequest("CatalogPriceCalculationRequest"),
          responses: {
            201: jsonResponse("Price calculation.", "CatalogPriceCalculationEnvelope"),
            400: errorResponse("Invalid quantity or specification."),
            404: errorResponse("Snapshot not found."),
            409: errorResponse("Price changed or specification sold out.")
          }
        }
      },
      "/api/v2/orders": {
        post: {
          tags: ["Orders"], summary: "Create a parent order with item sub-orders", operationId: "createOrder",
          security: [{ bearerAuth: [] }], requestBody: jsonRequest("OrderCreateRequest"),
          responses: {
            201: jsonResponse("Order created.", "OrderEnvelope"),
            200: jsonResponse("Existing order for a duplicate submit key.", "OrderEnvelope"),
            400: errorResponse("Invalid items."),
            404: errorResponse("Snapshot not found."),
            409: errorResponse("Price changed or item not purchasable.")
          }
        },
        get: {
          tags: ["Orders"], summary: "List the current user's orders", operationId: "listOrders",
          security: [{ bearerAuth: [] }], responses: { 200: jsonResponse("Orders.", "OrderListEnvelope") }
        }
      },
      "/api/v2/orders/{id}": {
        get: {
          tags: ["Orders"], summary: "Get an owned parent order and its items", operationId: "getOrder",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")],
          responses: { 200: jsonResponse("Order detail.", "OrderEnvelope"), 404: errorResponse("Order not found.") }
        }
      },
      "/admin/procurement/accounts": {
        post: {
          tags: ["Procurement"], summary: "Create a purchase platform account", operationId: "createPurchaseAccount",
          security: [{ bearerAuth: [] }], requestBody: jsonRequest("CreatePurchaseAccountRequest"),
          responses: {
            201: jsonResponse("Account created.", "PurchaseAccountEnvelope"),
            400: errorResponse("Invalid input."), 403: errorResponse("Permission denied.")
          }
        },
        get: {
          tags: ["Procurement"], summary: "List purchase accounts", operationId: "listPurchaseAccounts",
          security: [{ bearerAuth: [] }],
          parameters: [queryParameter("platform"), queryParameter("enabled", { type: "string", enum: ["true", "false"] })],
          responses: { 200: jsonResponse("Accounts.", "PurchaseAccountListEnvelope"), 403: errorResponse("Permission denied.") }
        }
      },
      "/admin/procurement/accounts/{id}": {
        patch: {
          tags: ["Procurement"], summary: "Update a purchase account (version-guarded)", operationId: "updatePurchaseAccount",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: jsonRequest("UpdatePurchaseAccountRequest"),
          responses: {
            200: jsonResponse("Account updated.", "PurchaseAccountEnvelope"),
            400: errorResponse("Invalid input."), 404: errorResponse("Account not found."),
            409: errorResponse("Version conflict.")
          }
        }
      },
      "/admin/procurement/tasks": {
        get: {
          tags: ["Procurement"], summary: "List procurement tasks (scope-filtered)", operationId: "listProcurementTasks",
          security: [{ bearerAuth: [] }],
          parameters: [queryParameter("platform"), queryParameter("status"), queryParameter("item_no"),
            queryParameter("limit", { type: "integer" }), queryParameter("offset", { type: "integer" })],
          responses: {
            200: jsonResponse("Tasks.", "ProcurementTaskListEnvelope"),
            400: errorResponse("Exact search required for this role."), 403: errorResponse("Permission denied.")
          }
        }
      },
      "/admin/procurement/tasks/{id}": {
        get: {
          tags: ["Procurement"], summary: "Item sub-order workbench detail + timeline", operationId: "getProcurementTaskDetail",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")],
          responses: { 200: jsonResponse("Task detail.", "ProcurementTaskDetailEnvelope"), 404: errorResponse("Item not found.") }
        }
      },
      "/admin/procurement/tasks/{id}/claim": {
        post: {
          tags: ["Procurement"], summary: "Claim an agent_ordering item", operationId: "claimProcurementTask",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")],
          responses: {
            200: jsonResponse("Claimed.", "ProcurementTaskEnvelope"),
            404: errorResponse("Item not found."), 409: errorResponse("Already claimed or not claimable.")
          }
        }
      },
      "/admin/procurement/tasks/{id}/confirm": {
        post: {
          tags: ["Procurement"], summary: "Confirm the real purchase", operationId: "confirmProcurementPurchase",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: jsonRequest("ConfirmPurchaseRequest"),
          responses: {
            201: jsonResponse("Confirmed.", "PurchaseConfirmationEnvelope"),
            400: errorResponse("Invalid input."), 403: errorResponse("Not the claiming buyer."),
            404: errorResponse("Item not found."), 409: errorResponse("Already confirmed or wrong state.")
          }
        }
      },
      "/admin/procurement/tasks/{id}/price-increase": {
        post: {
          tags: ["Procurement"], summary: "Raise a price-increase exception", operationId: "raisePriceIncrease",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: jsonRequest("RaisePriceIncreaseRequest"),
          responses: {
            201: jsonResponse("Exception raised.", "OrderExceptionEnvelope"),
            400: errorResponse("Invalid new price."), 404: errorResponse("Item not found."),
            409: errorResponse("Wrong state or exception already active.")
          }
        }
      },
      "/admin/procurement/tasks/{id}/availability": {
        post: {
          tags: ["Procurement"], summary: "Raise an availability exception", operationId: "raiseAvailability",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: jsonRequest("RaiseAvailabilityRequest"),
          responses: {
            201: jsonResponse("Exception raised.", "OrderExceptionEnvelope"),
            404: errorResponse("Item not found."), 409: errorResponse("Wrong state or exception already active.")
          }
        }
      },
      "/api/v2/orders/items/{id}/exception": {
        get: {
          tags: ["Orders"], summary: "Get the open exception on an item and its history", operationId: "getItemException",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")],
          responses: { 200: jsonResponse("Exception detail.", "OrderExceptionDetailEnvelope"), 404: errorResponse("Item not found.") }
        }
      },
      "/api/v2/orders/items/{id}/exception/respond": {
        post: {
          tags: ["Orders"], summary: "Respond to a purchase exception", operationId: "respondItemException",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: jsonRequest("ExceptionRespondRequest"),
          responses: {
            200: jsonResponse("Exception resolved.", "OrderExceptionEnvelope"),
            400: errorResponse("Invalid choice."), 404: errorResponse("Item or exception not found."),
            409: errorResponse("Exception expired or already handled.")
          }
        }
      },
      "/admin/procurement/tasks/{id}/dispatch": {
        post: {
          tags: ["Procurement"], summary: "Register merchant dispatch", operationId: "registerDispatch",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: jsonRequest("RegisterDispatchRequest"),
          responses: {
            201: jsonResponse("Dispatched.", "OrderItemEnvelope"), 400: errorResponse("Missing tracking."),
            404: errorResponse("Item not found."), 409: errorResponse("Wrong state or tracking conflict.")
          }
        },
        patch: {
          tags: ["Procurement"], summary: "Correct a merchant dispatch", operationId: "correctDispatch",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: jsonRequest("RegisterDispatchRequest"),
          responses: {
            200: jsonResponse("Corrected.", "OrderItemEnvelope"), 404: errorResponse("Item not found."),
            409: errorResponse("Not dispatched or tracking conflict.")
          }
        }
      },
      "/admin/procurement/tasks/{id}/reassign": {
        post: {
          tags: ["Procurement"], summary: "Lead reassigns account/buyer", operationId: "reassignTask",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: jsonRequest("ReassignRequest"),
          responses: {
            200: jsonResponse("Reassigned.", "OrderItemEnvelope"), 403: errorResponse("Permission denied."),
            404: errorResponse("Item not found."), 409: errorResponse("Terminal item.")
          }
        }
      },
      "/admin/procurement/tasks/{id}/correct": {
        post: {
          tags: ["Procurement"], summary: "Controlled status correction", operationId: "controlledCorrection",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: jsonRequest("ControlledCorrectionRequest"),
          responses: {
            200: jsonResponse("Corrected.", "OrderItemEnvelope"), 400: errorResponse("Unknown status."),
            403: errorResponse("Super-admin required for terminal correction."), 404: errorResponse("Item not found.")
          }
        }
      },
      "/api/v2/wallet": {
        get: {
          tags: ["Wallet (V2)"], summary: "Get the current user's CNY wallet balance", operationId: "getWalletV2",
          security: [{ bearerAuth: [] }],
          responses: { 200: jsonResponse("Wallet balance.", "WalletV2Envelope") }
        }
      },
      "/api/v2/wallet/transactions": {
        get: {
          tags: ["Wallet (V2)"], summary: "List the current user's ledger transactions", operationId: "listWalletTransactions",
          security: [{ bearerAuth: [] }],
          responses: { 200: jsonResponse("Transactions.", "WalletTransactionListEnvelope") }
        }
      },
      "/api/v2/wallet/top-ups": {
        post: {
          tags: ["Wallet (V2)"], summary: "Create a wallet top-up", operationId: "createTopUp",
          security: [{ bearerAuth: [] }], requestBody: jsonRequest("CreateTopUpRequest"),
          responses: {
            201: jsonResponse("Top-up created.", "TopUpEnvelope"),
            200: jsonResponse("Existing top-up for a duplicate key.", "TopUpEnvelope"),
            400: errorResponse("Invalid amount/currency."), 409: errorResponse("Payment not configured.")
          }
        },
        get: {
          tags: ["Wallet (V2)"], summary: "List the current user's top-ups", operationId: "listTopUps",
          security: [{ bearerAuth: [] }], responses: { 200: jsonResponse("Top-ups.", "TopUpListEnvelope") }
        }
      },
      "/api/v2/orders/{id}/pay": {
        post: {
          tags: ["Wallet (V2)"], summary: "Pay a parent order from the wallet", operationId: "payOrder",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")],
          responses: {
            200: jsonResponse("Order paid.", "OrderPaymentEnvelope"),
            404: errorResponse("Order not found."), 409: errorResponse("Insufficient balance.")
          }
        }
      },
      "/api/v2/orders/{id}/payment-preview": {
        get: {
          tags: ["Wallet (V2)"], summary: "Order payment shortfall preview", operationId: "orderPaymentPreview",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")],
          responses: { 200: jsonResponse("Preview.", "OrderPaymentPreview"), 404: errorResponse("Order not found.") }
        }
      },
      "/api/v2/orders/items/{id}/pay-surcharge": {
        post: {
          tags: ["Wallet (V2)"], summary: "Pay a price-increase surcharge from the wallet", operationId: "paySurcharge",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")],
          responses: {
            200: jsonResponse("Surcharge paid.", "SurchargePaymentEnvelope"),
            404: errorResponse("Item not found."), 409: errorResponse("Expired, insufficient, or no surcharge.")
          }
        }
      },
      "/api/v2/wallet/withdrawals": {
        post: {
          tags: ["Wallet (V2)"], summary: "Request a withdrawal (freezes the amount)", operationId: "requestWithdrawal",
          security: [{ bearerAuth: [] }], requestBody: jsonRequest("RequestWithdrawalRequest"),
          responses: { 201: jsonResponse("Requested.", "WithdrawalEnvelope"), 400: errorResponse("Invalid amount."), 409: errorResponse("Insufficient balance.") }
        },
        get: {
          tags: ["Wallet (V2)"], summary: "List the current user's withdrawals", operationId: "listWithdrawals",
          security: [{ bearerAuth: [] }], responses: { 200: jsonResponse("Withdrawals.", "WithdrawalListEnvelope") }
        }
      },
      "/admin/finance/withdrawals/{id}/review": {
        post: {
          tags: ["Wallet (V2)"], summary: "Review a withdrawal (approve/reject)", operationId: "reviewWithdrawal",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: jsonRequest("ReviewWithdrawalRequest"),
          responses: { 200: jsonResponse("Reviewed.", "WithdrawalEnvelope"), 403: errorResponse("Permission denied."), 404: errorResponse("Not found."), 409: errorResponse("Not pending.") }
        }
      },
      "/admin/finance/withdrawals/{id}/execute": {
        post: {
          tags: ["Wallet (V2)"], summary: "Execute an approved withdrawal", operationId: "executeWithdrawal",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")],
          responses: { 200: jsonResponse("Executed.", "WithdrawalEnvelope"), 403: errorResponse("Permission denied."), 404: errorResponse("Not found."), 409: errorResponse("Not processing.") }
        }
      },
      "/admin/finance/adjustments": {
        post: {
          tags: ["Wallet (V2)"], summary: "Create a manual adjustment request", operationId: "createAdjustment",
          security: [{ bearerAuth: [] }], requestBody: jsonRequest("CreateAdjustmentRequest"),
          responses: { 201: jsonResponse("Created.", "AdjustmentEnvelope"), 400: errorResponse("Invalid input."), 403: errorResponse("Permission denied."), 409: errorResponse("Daily limit exceeded.") }
        },
        get: {
          tags: ["Wallet (V2)"], summary: "List adjustment requests", operationId: "listAdjustments",
          security: [{ bearerAuth: [] }], responses: { 200: jsonResponse("Adjustments.", "AdjustmentListEnvelope"), 403: errorResponse("Permission denied.") }
        }
      },
      "/admin/finance/adjustments/{id}/approve": {
        post: {
          tags: ["Wallet (V2)"], summary: "Super-admin approves + executes an adjustment", operationId: "approveAdjustment",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")],
          responses: { 200: jsonResponse("Approved.", "AdjustmentEnvelope"), 403: errorResponse("Not super-admin or self-approval."), 404: errorResponse("Not found."), 409: errorResponse("Not pending.") }
        }
      },
      "/admin/finance/adjustments/{id}/reject": {
        post: {
          tags: ["Wallet (V2)"], summary: "Reject an adjustment request", operationId: "rejectAdjustment",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(),
          responses: { 200: jsonResponse("Rejected.", "AdjustmentEnvelope"), 403: errorResponse("Permission denied."), 404: errorResponse("Not found."), 409: errorResponse("Not pending.") }
        }
      },
      "/admin/finance/topup-exceptions": {
        get: {
          tags: ["Wallet (V2)"], summary: "List failed/exception top-ups", operationId: "listTopUpExceptions",
          security: [{ bearerAuth: [] }], parameters: [queryParameter("status"), queryParameter("limit", { type: "integer" }), queryParameter("offset", { type: "integer" })],
          responses: { 200: jsonResponse("Top-ups.", "TopUpListEnvelope"), 403: errorResponse("Permission denied.") }
        }
      },
      "/admin/finance/reconciliation": {
        post: {
          tags: ["Wallet (V2)"], summary: "Import a provider reconciliation file", operationId: "importReconciliation",
          security: [{ bearerAuth: [] }], requestBody: jsonRequest("ReconciliationImportRequest"),
          responses: { 201: jsonResponse("Imported.", "ReconciliationEnvelope"), 400: errorResponse("Invalid input."), 403: errorResponse("Permission denied.") }
        }
      },
      "/webhooks/payments": {
        post: {
          tags: ["Wallet (V2)"], summary: "Signed payment provider webhook", operationId: "paymentWebhook",
          requestBody: genericRequest(), parameters: [headerParameter("x-goatedbuy-signature")],
          responses: {
            200: jsonResponse("Processed.", "PaymentWebhookEnvelope"),
            400: errorResponse("Invalid signature."), 404: errorResponse("Top-up not found."),
            409: errorResponse("Amount/currency mismatch.")
          }
        }
      },
      "/admin/finance/exchange-rates": {
        post: {
          tags: ["Wallet (V2)"], summary: "Set an exchange rate (new version)", operationId: "setExchangeRate",
          security: [{ bearerAuth: [] }], requestBody: jsonRequest("SetExchangeRateRequest"),
          responses: { 201: jsonResponse("Rate set.", "ExchangeRateEnvelope"), 400: errorResponse("Invalid rate."), 403: errorResponse("Permission denied.") }
        },
        get: {
          tags: ["Wallet (V2)"], summary: "List exchange rates", operationId: "listExchangeRates",
          security: [{ bearerAuth: [] }], parameters: [queryParameter("currency")],
          responses: { 200: jsonResponse("Rates.", "ExchangeRateListEnvelope"), 403: errorResponse("Permission denied.") }
        }
      },
      "/admin/wms/inbound/scan": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Scan a courier number on arrival", operationId: "scanInbound",
          security: [{ bearerAuth: [] }], requestBody: jsonRequest("ScanInboundRequest"),
          responses: {
            201: jsonResponse("Scanned.", "InboundEnvelope"), 200: jsonResponse("Duplicate scan.", "InboundEnvelope"),
            400: errorResponse("Missing tracking."), 403: errorResponse("Permission denied.")
          }
        }
      },
      "/admin/wms/inbound/unclaimed": {
        get: {
          tags: ["Warehouse (V2)"], summary: "List unclaimed inbound packages", operationId: "listUnclaimedInbound",
          security: [{ bearerAuth: [] }], responses: { 200: jsonResponse("Packages.", "InboundListEnvelope"), 403: errorResponse("Permission denied.") }
        }
      },
      "/admin/wms/inbound/{id}/link": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Manually link an unclaimed package", operationId: "linkInbound",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: jsonRequest("LinkInboundRequest"),
          responses: { 200: jsonResponse("Linked.", "InboundEnvelope"), 400: errorResponse("Evidence required."), 404: errorResponse("Not found."), 409: errorResponse("Not unclaimed.") }
        }
      },
      "/admin/wms/inbound/{id}/measure": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Submit measurement + outer photos", operationId: "measureInbound",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: jsonRequest("MeasureInboundRequest"),
          responses: { 200: jsonResponse("Measured.", "InboundEnvelope"), 400: errorResponse("Invalid input / no photo."), 404: errorResponse("Not found."), 409: errorResponse("Version conflict.") }
        }
      },
      "/api/v2/inbound": {
        get: {
          tags: ["Warehouse (V2)"], summary: "List the current user's inbound packages", operationId: "listMyInbound",
          security: [{ bearerAuth: [] }], responses: { 200: jsonResponse("Packages.", "InboundListEnvelope") }
        }
      },
      "/admin/wms/qc/tasks": {
        get: {
          tags: ["Warehouse (V2)"], summary: "List QC tasks", operationId: "listQcTasks",
          security: [{ bearerAuth: [] }], parameters: [queryParameter("status"), queryParameter("mine", { type: "string", enum: ["true", "false"] })],
          responses: { 200: jsonResponse("QC tasks.", "QcTaskListEnvelope"), 403: errorResponse("Permission denied.") }
        }
      },
      "/admin/wms/qc/tasks/{id}": {
        get: {
          tags: ["Warehouse (V2)"], summary: "QC task detail + photos", operationId: "getQcTask",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")],
          responses: { 200: jsonResponse("QC task.", "QcTaskDetailEnvelope"), 404: errorResponse("Not found.") }
        }
      },
      "/admin/wms/qc/tasks/{id}/claim": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Claim a QC task", operationId: "claimQc",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")],
          responses: { 200: jsonResponse("Claimed.", "QcTaskEnvelope"), 404: errorResponse("Not found."), 409: errorResponse("Already claimed.") }
        }
      },
      "/admin/wms/qc/tasks/{id}/start": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Start a claimed QC task", operationId: "startQc",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")],
          responses: { 200: jsonResponse("Started.", "QcTaskEnvelope"), 409: errorResponse("Not your claimed task.") }
        }
      },
      "/admin/wms/qc/tasks/{id}/release": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Release a QC task", operationId: "releaseQc",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")],
          responses: { 200: jsonResponse("Released.", "QcTaskEnvelope"), 409: errorResponse("Cannot release.") }
        }
      },
      "/admin/wms/qc/tasks/{id}/photo": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Upload a QC photo slot", operationId: "uploadQcPhoto",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: jsonRequest("QcPhotoRequest"),
          responses: { 201: jsonResponse("Uploaded.", "QcPhotoEnvelope"), 400: errorResponse("Invalid slot."), 403: errorResponse("Not the assignee.") }
        }
      },
      "/api/v2/inventory/{stockNo}/storage": {
        get: {
          tags: ["Warehouse (V2)"], summary: "Storage status for an item", operationId: "getStorageStatus",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("stockNo")],
          responses: { 200: jsonResponse("Storage.", "StorageEnvelope"), 404: errorResponse("Not found.") }
        }
      },
      "/api/v2/inventory/{stockNo}/extend-storage": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Buy a paid storage extension", operationId: "extendStorage",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("stockNo")], requestBody: jsonRequest("ExtendStorageRequest"),
          responses: { 201: jsonResponse("Extended.", "StorageEnvelope"), 200: jsonResponse("Existing.", "StorageEnvelope"), 409: errorResponse("Max extension / insufficient balance.") }
        }
      },
      "/admin/wms/inventory/{stockNo}/mark-destroy": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Mark an overdue item for destruction", operationId: "markForDestroy",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("stockNo")],
          responses: { 200: jsonResponse("Marked.", "InventoryEnvelope"), 404: errorResponse("Not found."), 409: errorResponse("Not eligible before 150 days.") }
        }
      },
      "/admin/wms/inventory/{stockNo}/destroy": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Execute destruction (irreversible)", operationId: "executeDestroy",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("stockNo")], requestBody: jsonRequest("DestroyRequest"),
          responses: { 200: jsonResponse("Destroyed.", "InventoryEnvelope"), 400: errorResponse("Photos required."), 409: errorResponse("Not pending destruction.") }
        }
      },
      "/admin/wms/locations": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Create a warehouse location", operationId: "createLocation",
          security: [{ bearerAuth: [] }], requestBody: jsonRequest("CreateLocationRequest"),
          responses: { 201: jsonResponse("Created.", "LocationEnvelope"), 403: errorResponse("Permission denied.") }
        },
        get: {
          tags: ["Warehouse (V2)"], summary: "List warehouse locations", operationId: "listLocations",
          security: [{ bearerAuth: [] }], responses: { 200: jsonResponse("Locations.", "LocationListEnvelope") }
        }
      },
      "/admin/wms/locations/{id}/disable": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Disable an empty location", operationId: "disableLocation",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")],
          responses: { 200: jsonResponse("Disabled.", "LocationEnvelope"), 404: errorResponse("Not found."), 409: errorResponse("Location occupied.") }
        }
      },
      "/admin/wms/inventory/assign-location": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Double-scan assign a location", operationId: "assignLocation",
          security: [{ bearerAuth: [] }], requestBody: jsonRequest("AssignLocationRequest"),
          responses: { 200: jsonResponse("Assigned.", "InventoryEnvelope"), 404: errorResponse("Not found."), 409: errorResponse("Already assigned / disabled.") }
        }
      },
      "/admin/wms/inventory/move-location": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Double-scan move a location", operationId: "moveLocation",
          security: [{ bearerAuth: [] }], requestBody: jsonRequest("MoveLocationRequest"),
          responses: { 200: jsonResponse("Moved.", "InventoryEnvelope"), 404: errorResponse("Not found."), 409: errorResponse("Origin mismatch.") }
        }
      },
      "/admin/wms/inventory/shipping-restrictions": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Set shipping restrictions", operationId: "setShippingRestrictions",
          security: [{ bearerAuth: [] }], requestBody: jsonRequest("ShippingRestrictionsRequest"),
          responses: { 200: jsonResponse("Set.", "InventoryEnvelope"), 404: errorResponse("Not found.") }
        }
      },
      "/admin/wms/qc/tasks/{id}/complete": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Complete QC and officially warehouse", operationId: "completeQc",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")],
          responses: { 200: jsonResponse("Completed.", "QcCompleteEnvelope"), 404: errorResponse("Not found."), 409: errorResponse("Prerequisites unmet.") }
        }
      },
      "/api/v2/inventory": {
        get: {
          tags: ["Warehouse (V2)"], summary: "List the current user's in-stock inventory", operationId: "listMyInventory",
          security: [{ bearerAuth: [] }], responses: { 200: jsonResponse("Inventory.", "InventoryListEnvelope") }
        }
      },
      "/admin/wms/qc/tasks/{id}/exception": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Raise a QC exception", operationId: "raiseQcException",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: jsonRequest("QcExceptionRequest"),
          responses: { 201: jsonResponse("Raised.", "QcTaskEnvelope"), 403: errorResponse("Not the assignee.") }
        }
      },
      "/admin/wms/qc/tasks/{id}/exception/resolve": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Resolve a QC exception", operationId: "resolveQcException",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("id")],
          responses: { 200: jsonResponse("Resolved.", "QcTaskEnvelope"), 409: errorResponse("No open exception.") }
        }
      },
      "/api/v2/qc/{itemId}/extra-photos": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Buy extra QC photos", operationId: "buyExtraPhotos",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("itemId")], requestBody: jsonRequest("QcExtraRequest"),
          responses: { 201: jsonResponse("Purchased.", "QcPurchaseEnvelope"), 200: jsonResponse("Existing.", "QcPurchaseEnvelope"), 400: errorResponse("Invalid quantity."), 409: errorResponse("Insufficient balance.") }
        }
      },
      "/api/v2/qc/{itemId}/detailed": {
        post: {
          tags: ["Warehouse (V2)"], summary: "Buy a detailed inspection", operationId: "buyDetailedCheck",
          security: [{ bearerAuth: [] }], parameters: [pathParameter("itemId")], requestBody: jsonRequest("QcDetailedRequest"),
          responses: { 201: jsonResponse("Purchased.", "QcPurchaseEnvelope"), 200: jsonResponse("Existing.", "QcPurchaseEnvelope"), 400: errorResponse("Invalid items."), 409: errorResponse("Insufficient balance.") }
        }
      },
      "/admin/logistics/carriers": {
        post: { tags: ["Logistics (V2)"], summary: "Create a carrier", operationId: "createCarrier", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Created."), 403: errorResponse("Super-admin only.") } },
        get: { tags: ["Logistics (V2)"], summary: "List carriers", operationId: "listCarriers", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Carriers.") } }
      },
      "/admin/logistics/routes": {
        post: { tags: ["Logistics (V2)"], summary: "Create a route", operationId: "createRoute", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Created."), 403: errorResponse("Super-admin only."), 404: errorResponse("Carrier not found.") } }
      },
      "/admin/logistics/routes/{code}/price": {
        post: { tags: ["Logistics (V2)"], summary: "Set a route price (new version)", operationId: "setPriceVersion", security: [{ bearerAuth: [] }], parameters: [pathParameter("code")], requestBody: jsonRequest("SetPriceVersionRequest"), responses: { 201: jsonResponse("Set.", "PriceVersionEnvelope"), 403: errorResponse("Super-admin only."), 404: errorResponse("Route not found.") } }
      },
      "/admin/logistics/routes/{code}/price-versions": {
        get: { tags: ["Logistics (V2)"], summary: "List price versions", operationId: "listPriceVersions", security: [{ bearerAuth: [] }], parameters: [pathParameter("code")], responses: { 200: okResponse("Versions."), 404: errorResponse("Route not found.") } }
      },
      "/api/v2/logistics/routes": {
        get: { tags: ["Logistics (V2)"], summary: "List available routes", operationId: "listRoutes", security: [{ bearerAuth: [] }], parameters: [queryParameter("country")], responses: { 200: okResponse("Routes.") } }
      },
      "/api/v2/logistics/quote": {
        post: { tags: ["Logistics (V2)"], summary: "Quote freight for a route", operationId: "quoteFreight", security: [{ bearerAuth: [] }], requestBody: jsonRequest("FreightQuoteRequest"), responses: { 200: jsonResponse("Quote.", "FreightQuoteEnvelope"), 404: errorResponse("Route not available.") } }
      },
      "/admin/consolidation/value-added-services": {
        post: { tags: ["Consolidation (V2)"], summary: "Create a value-added service", operationId: "createValueAddedService", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Created."), 403: errorResponse("Super-admin only.") } },
        get: { tags: ["Consolidation (V2)"], summary: "List value-added services", operationId: "listValueAddedServices", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Services.") } }
      },
      "/admin/consolidation/value-added-services/{id}": {
        patch: { tags: ["Consolidation (V2)"], summary: "Update a value-added service", operationId: "updateValueAddedService", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Updated."), 403: errorResponse("Super-admin only."), 404: errorResponse("Not found.") } }
      },
      "/api/v2/consolidation/value-added-services": {
        get: { tags: ["Consolidation (V2)"], summary: "List enabled value-added services", operationId: "listEnabledValueAddedServices", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Services.") } }
      },
      "/api/v2/consolidation/eligible-stock": {
        get: { tags: ["Consolidation (V2)"], summary: "List stock eligible for consolidation", operationId: "listEligibleStock", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Eligible stock.") } }
      },
      "/api/v2/consolidation/parcels": {
        post: { tags: ["Consolidation (V2)"], summary: "Create a draft parcel (reserves stock)", operationId: "createParcel", security: [{ bearerAuth: [] }], requestBody: jsonRequest("CreateParcelRequest"), responses: { 201: okResponse("Created."), 403: errorResponse("Not your stock."), 404: errorResponse("Address or unit not found."), 409: errorResponse("Unit not available.") } },
        get: { tags: ["Consolidation (V2)"], summary: "List my parcels", operationId: "listMyParcels", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Parcels.") } }
      },
      "/api/v2/consolidation/parcels/{id}": {
        get: { tags: ["Consolidation (V2)"], summary: "Get a parcel", operationId: "getParcel", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Parcel."), 404: errorResponse("Not found.") } }
      },
      "/api/v2/consolidation/parcels/{id}/submit": {
        post: { tags: ["Consolidation (V2)"], summary: "Submit a draft parcel (creates the packing bill)", operationId: "submitParcel", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Submitted."), 404: errorResponse("Not found."), 409: errorResponse("Not a draft.") } }
      },
      "/api/v2/consolidation/parcels/{id}/packing-fee/pay": {
        post: { tags: ["Consolidation (V2)"], summary: "Pay the packing fee from the wallet", operationId: "payPackingBill", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Paid."), 404: errorResponse("No bill."), 409: errorResponse("Not payable.") } }
      },
      "/api/v2/consolidation/parcels/{id}/shipping-fee/pay": {
        post: { tags: ["Consolidation (V2)"], summary: "Pay the international shipping fee from the wallet", operationId: "payShippingBill", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Paid."), 404: errorResponse("No bill."), 409: errorResponse("Not payable.") } }
      },
      "/api/v2/consolidation/parcels/{id}/cancel": {
        post: { tags: ["Consolidation (V2)"], summary: "Cancel before packing (releases stock, refunds paid fees)", operationId: "cancelParcel", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Cancelled."), 404: errorResponse("Not found."), 409: errorResponse("Packing started.") } }
      },
      "/admin/consolidation/parcels/{id}": {
        get: { tags: ["Consolidation (V2)"], summary: "Get a parcel (warehouse view)", operationId: "adminGetParcel", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Parcel."), 404: errorResponse("Not found.") } }
      },
      "/admin/consolidation/parcels/{id}/accept": {
        post: { tags: ["Consolidation (V2)"], summary: "Accept a paid parcel for picking", operationId: "acceptForPicking", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Picking."), 409: errorResponse("Bad state.") } }
      },
      "/admin/consolidation/parcels/{id}/picking/claim": {
        post: { tags: ["Consolidation (V2)"], summary: "Claim the picking task", operationId: "claimPicking", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Claimed."), 409: errorResponse("Already claimed.") } }
      },
      "/admin/consolidation/parcels/{id}/picking/scan": {
        post: { tags: ["Consolidation (V2)"], summary: "Scan one unit into the parcel", operationId: "scanPickItem", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Scanned."), 409: errorResponse("Foreign or not picking.") } }
      },
      "/admin/consolidation/parcels/{id}/packing/start": {
        post: { tags: ["Consolidation (V2)"], summary: "Review and start packing (locks the parcel)", operationId: "startPacking", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Packing."), 409: errorResponse("Picking incomplete.") } }
      },
      "/admin/consolidation/parcels/{id}/value-added-services/execute": {
        post: { tags: ["Consolidation (V2)"], summary: "Execute a value-added service during packing", operationId: "executeValueAddedService", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Executed."), 400: errorResponse("Photos required."), 409: errorResponse("Not packing.") } }
      },
      "/admin/consolidation/parcels/{id}/measurement": {
        post: { tags: ["Consolidation (V2)"], summary: "Final measurement → international shipping bill", operationId: "finalizeMeasurement", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Shipping fee due."), 409: errorResponse("Not packing / not quotable / VAS incomplete.") } }
      },
      "/admin/consolidation/parcels/{id}/outbound": {
        post: { tags: ["Consolidation (V2)"], summary: "Record seal / label / outbound photos (→ outbound)", operationId: "recordOutbound", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Outbound."), 400: errorResponse("Photos required."), 409: errorResponse("Not awaiting outbound.") } }
      },
      "/admin/outbound/batches": {
        post: { tags: ["Outbound (V2)"], summary: "Create an outbound batch", operationId: "createOutboundBatch", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Created."), 404: errorResponse("Carrier not found.") } },
        get: { tags: ["Outbound (V2)"], summary: "List outbound batches", operationId: "listOutboundBatches", security: [{ bearerAuth: [] }], parameters: [queryParameter("status")], responses: { 200: okResponse("Batches.") } }
      },
      "/admin/outbound/batches/{id}": {
        get: { tags: ["Outbound (V2)"], summary: "Get an outbound batch", operationId: "getOutboundBatch", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Batch."), 404: errorResponse("Not found.") } }
      },
      "/admin/outbound/batches/{id}/load": {
        post: { tags: ["Outbound (V2)"], summary: "Load an outbound parcel into the batch", operationId: "loadOutboundParcel", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Loaded."), 409: errorResponse("Not loadable.") } }
      },
      "/admin/outbound/batches/{id}/handoff-pending": {
        post: { tags: ["Outbound (V2)"], summary: "Move a loading batch to handoff-pending", operationId: "batchHandoffPending", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Handoff pending."), 409: errorResponse("Bad state.") } }
      },
      "/admin/outbound/batches/{id}/handoff": {
        post: { tags: ["Outbound (V2)"], summary: "Confirm handoff (signed evidence + tracking writeback)", operationId: "confirmBatchHandoff", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Handed off."), 400: errorResponse("Evidence required."), 409: errorResponse("Bad state.") } }
      },
      "/admin/outbound/batches/{id}/complete": {
        post: { tags: ["Outbound (V2)"], summary: "Complete a handed-off batch", operationId: "completeOutboundBatch", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Completed."), 409: errorResponse("Bad state.") } }
      },
      "/admin/outbound/batches/{id}/cancel": {
        post: { tags: ["Outbound (V2)"], summary: "Cancel a batch before handoff", operationId: "cancelOutboundBatch", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Cancelled."), 409: errorResponse("Bad state.") } }
      },
      "/admin/outbound/tracking/sync": {
        post: { tags: ["Outbound (V2)"], summary: "Sync a parcel tracking event", operationId: "syncTracking", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 200: okResponse("Synced."), 409: errorResponse("Illegal transition.") } }
      },
      "/api/v2/after-sales/items/{itemId}/eligibility": {
        get: { tags: ["After-Sales (V2)"], summary: "Check 5-day return eligibility", operationId: "checkReturnEligibility", security: [{ bearerAuth: [] }], parameters: [pathParameter("itemId")], responses: { 200: okResponse("Eligibility."), 404: errorResponse("Item not found.") } }
      },
      "/api/v2/after-sales/items/{itemId}/return": {
        post: { tags: ["After-Sales (V2)"], summary: "Open a return request", operationId: "requestReturn", security: [{ bearerAuth: [] }], parameters: [pathParameter("itemId")], requestBody: genericRequest(), responses: { 201: okResponse("Opened."), 404: errorResponse("Item not found."), 409: errorResponse("Not eligible.") } }
      },
      "/api/v2/after-sales": {
        get: { tags: ["After-Sales (V2)"], summary: "List my after-sales orders", operationId: "listMyAfterSales", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Orders.") } }
      },
      "/api/v2/after-sales/{id}": {
        get: { tags: ["After-Sales (V2)"], summary: "Get an after-sales order", operationId: "getAfterSales", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Order."), 404: errorResponse("Not found.") } }
      },
      "/api/v2/after-sales/{id}/material": {
        post: { tags: ["After-Sales (V2)"], summary: "Supplement material (awaiting-material only)", operationId: "supplementMaterial", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Re-review."), 409: errorResponse("Not awaiting material.") } }
      },
      "/api/v2/after-sales/{id}/return-fee/pay": {
        post: { tags: ["After-Sales (V2)"], summary: "Pay the return fee from the wallet", operationId: "payReturnFee", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Paid → picking."), 404: errorResponse("No bill."), 409: errorResponse("Not payable.") } }
      },
      "/admin/after-sales": {
        get: { tags: ["After-Sales (V2)"], summary: "Staff after-sales worklist", operationId: "listStaffAfterSales", security: [{ bearerAuth: [] }], parameters: [queryParameter("status")], responses: { 200: okResponse("Orders.") } }
      },
      "/admin/after-sales/{id}": {
        get: { tags: ["After-Sales (V2)"], summary: "Get an after-sales order (staff)", operationId: "adminGetAfterSales", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Order."), 404: errorResponse("Not found.") } }
      },
      "/admin/after-sales/{id}/review/start": {
        post: { tags: ["After-Sales (V2)"], summary: "Start procurement review", operationId: "startAfterSalesReview", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Reviewing."), 409: errorResponse("Illegal transition.") } }
      },
      "/admin/after-sales/{id}/review/approve": {
        post: { tags: ["After-Sales (V2)"], summary: "Approve (set responsible + freight party)", operationId: "approveAfterSales", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Approved."), 400: errorResponse("Party required."), 409: errorResponse("Illegal transition.") } }
      },
      "/admin/after-sales/{id}/review/reject": {
        post: { tags: ["After-Sales (V2)"], summary: "Reject (reason required, releases unit)", operationId: "rejectAfterSales", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Rejected."), 400: errorResponse("Reason required.") } }
      },
      "/admin/after-sales/{id}/review/request-material": {
        post: { tags: ["After-Sales (V2)"], summary: "Ask the user for material", operationId: "requestAfterSalesMaterial", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Awaiting material."), 409: errorResponse("Illegal transition.") } }
      },
      "/admin/after-sales/{id}/close": {
        post: { tags: ["After-Sales (V2)"], summary: "Close a stalled order (releases unit)", operationId: "closeAfterSales", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Closed."), 409: errorResponse("Not closable.") } }
      },
      "/admin/after-sales/{id}/return-pick/scan": {
        post: { tags: ["After-Sales (V2)"], summary: "Scan the returned item for picking", operationId: "scanReturnPick", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Picking → verifying."), 409: errorResponse("Wrong item / not picking.") } }
      },
      "/admin/after-sales/{id}/return-verify": {
        post: { tags: ["After-Sales (V2)"], summary: "Verify the return against QC (photos + measurement)", operationId: "verifyReturn", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Packing or exception."), 400: errorResponse("Photos required.") } }
      },
      "/admin/after-sales/{id}/return-pack": {
        post: { tags: ["After-Sales (V2)"], summary: "Pack the return", operationId: "packReturn", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Merchant return pending."), 400: errorResponse("Photos required.") } }
      },
      "/admin/after-sales/{id}/ship-back": {
        post: { tags: ["After-Sales (V2)"], summary: "Ship back to merchant (tracking + address snapshot)", operationId: "shipBackToMerchant", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Returned to merchant."), 400: errorResponse("Address required."), 409: errorResponse("Duplicate tracking.") } }
      },
      "/admin/after-sales/{id}/shipment-event": {
        post: { tags: ["After-Sales (V2)"], summary: "Record a ship-back event (rejected / exception)", operationId: "recordShipmentEvent", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Recorded.") } }
      },
      "/admin/after-sales/{id}/exception": {
        post: { tags: ["After-Sales (V2)"], summary: "Raise an after-sales exception", operationId: "raiseAfterSalesException", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Exception.") } }
      },
      "/admin/after-sales/{id}/exception/resolve": {
        post: { tags: ["After-Sales (V2)"], summary: "Resolve an exception to a legal node", operationId: "resolveAfterSalesException", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Resolved."), 409: errorResponse("Illegal transition.") } }
      },
      "/admin/after-sales/{id}/merchant-received": {
        post: { tags: ["After-Sales (V2)"], summary: "Mark the merchant received the return", operationId: "markMerchantReceived", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Awaiting merchant refund."), 409: errorResponse("Illegal transition.") } }
      },
      "/admin/after-sales/{id}/merchant-refund": {
        post: { tags: ["After-Sales (V2)"], summary: "Register the merchant refund (amount ≤ cap)", operationId: "registerMerchantRefund", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Platform refund pending."), 400: errorResponse("Exceeds cap.") } }
      },
      "/admin/after-sales/{id}/refund-preview": {
        get: { tags: ["After-Sales (V2)"], summary: "Preview the platform refund accounting", operationId: "previewAfterSalesRefund", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Accounting.") } }
      },
      "/admin/after-sales/{id}/refund/execute": {
        post: { tags: ["After-Sales (V2)"], summary: "Execute the finance wallet refund (idempotent)", operationId: "executeAfterSalesRefund", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Completed."), 409: errorResponse("Not awaiting refund.") } }
      },
      "/admin/users/search": {
        get: { tags: ["User Admin (V2)"], summary: "Search users by exact id/email/order/parcel or prefix", operationId: "searchUsers", security: [{ bearerAuth: [] }], parameters: [queryParameter("email"), queryParameter("order_no"), queryParameter("parcel_no"), queryParameter("q")], responses: { 200: okResponse("Results."), 400: errorResponse("Empty query.") } }
      },
      "/admin/users/{id}": {
        get: { tags: ["User Admin (V2)"], summary: "Role-tailored user detail", operationId: "getUserDetail", security: [{ bearerAuth: [] }], parameters: [pathParameter("id"), queryParameter("tab")], responses: { 200: okResponse("Detail."), 403: errorResponse("Tab not allowed."), 404: errorResponse("Not found.") } }
      },
      "/admin/users/{id}/assist-edit": {
        post: { tags: ["User Admin (V2)"], summary: "CS-assisted profile edit (identity verified)", operationId: "assistEditUser", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Updated."), 400: errorResponse("Verification required."), 409: errorResponse("Locked / conflict.") } }
      },
      "/admin/user-tags": {
        post: { tags: ["User Admin (V2)"], summary: "Create a user tag", operationId: "createUserTag", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Created."), 409: errorResponse("Exists.") } },
        get: { tags: ["User Admin (V2)"], summary: "List user tags", operationId: "listUserTags", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Tags.") } }
      },
      "/admin/user-tags/assign": {
        post: { tags: ["User Admin (V2)"], summary: "Assign a tag to a user", operationId: "assignUserTag", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 200: okResponse("Assigned."), 404: errorResponse("Tag not found.") } }
      },
      "/admin/user-tags/unassign": {
        post: { tags: ["User Admin (V2)"], summary: "Unassign a tag", operationId: "unassignUserTag", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 200: okResponse("Removed.") } }
      },
      "/admin/user-groups": {
        post: { tags: ["User Admin (V2)"], summary: "Create a static or dynamic group", operationId: "createUserGroup", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Created."), 400: errorResponse("Invalid rule.") } },
        get: { tags: ["User Admin (V2)"], summary: "List user groups", operationId: "listUserGroups", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Groups.") } }
      },
      "/admin/user-groups/{id}/rule": {
        patch: { tags: ["User Admin (V2)"], summary: "Update a dynamic group's rule (bumps version)", operationId: "updateUserGroupRule", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Updated."), 400: errorResponse("Invalid rule.") } }
      },
      "/admin/user-groups/{id}/members": {
        post: { tags: ["User Admin (V2)"], summary: "Add a static member", operationId: "addUserGroupMember", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Added."), 409: errorResponse("Not static.") } },
        get: { tags: ["User Admin (V2)"], summary: "List members (masked)", operationId: "listUserGroupMembers", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Members.") } },
        delete: { tags: ["User Admin (V2)"], summary: "Remove a member", operationId: "removeUserGroupMember", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Removed.") } }
      },
      "/admin/user-groups/{id}/recompute": {
        post: { tags: ["User Admin (V2)"], summary: "Recompute a dynamic group (idempotent)", operationId: "recomputeUserGroup", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Recomputed."), 409: errorResponse("Not dynamic.") } }
      },
      "/admin/membership/config": {
        post: { tags: ["Membership (V2)"], summary: "Publish a membership tier config version", operationId: "publishMembershipConfig", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Published."), 400: errorResponse("Invalid ladder."), 403: errorResponse("Super-admin only.") } },
        get: { tags: ["Membership (V2)"], summary: "Get the active membership config", operationId: "getMembershipConfig", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Config.") } }
      },
      "/admin/membership/config/versions": {
        get: { tags: ["Membership (V2)"], summary: "List membership config versions", operationId: "listMembershipConfigVersions", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Versions.") } }
      },
      "/api/v2/membership": {
        get: { tags: ["Membership (V2)"], summary: "My membership tier, progress, and discount", operationId: "getMembership", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Membership.") } }
      },
      "/admin/account-risk/events": {
        post: { tags: ["Account Risk (V2)"], summary: "Record a risk event (idempotent)", operationId: "recordRiskEvent", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Recorded.") } }
      },
      "/admin/account-risk/users/{userId}/events": {
        get: { tags: ["Account Risk (V2)"], summary: "List a user's risk events", operationId: "listRiskEvents", security: [{ bearerAuth: [] }], parameters: [pathParameter("userId")], responses: { 200: okResponse("Events.") } }
      },
      "/admin/account-risk/lock-requests": {
        post: { tags: ["Account Risk (V2)"], summary: "Finance initiates a lock request", operationId: "requestAccountLock", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Pending."), 400: errorResponse("Evidence required."), 403: errorResponse("Finance only."), 409: errorResponse("Active request exists.") } },
        get: { tags: ["Account Risk (V2)"], summary: "List lock requests", operationId: "listAccountLockRequests", security: [{ bearerAuth: [] }], parameters: [queryParameter("status")], responses: { 200: okResponse("Requests.") } }
      },
      "/admin/account-risk/lock-requests/{id}/approve": {
        post: { tags: ["Account Risk (V2)"], summary: "Super-admin approves (locks the account)", operationId: "approveAccountLock", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Locked."), 403: errorResponse("Super-admin only / self-approve."), 409: errorResponse("Not pending.") } }
      },
      "/admin/account-risk/lock-requests/{id}/reject": {
        post: { tags: ["Account Risk (V2)"], summary: "Super-admin rejects the request", operationId: "rejectAccountLock", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Rejected."), 409: errorResponse("Not pending.") } }
      },
      "/admin/account-risk/unlock": {
        post: { tags: ["Account Risk (V2)"], summary: "Super-admin unlocks an account", operationId: "unlockAccount", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 200: okResponse("Unlocked."), 409: errorResponse("Already normal.") } }
      },
      "/admin/account-risk/users/{userId}/status": {
        get: { tags: ["Account Risk (V2)"], summary: "Account status + history", operationId: "getAccountStatus", security: [{ bearerAuth: [] }], parameters: [pathParameter("userId")], responses: { 200: okResponse("Status."), 404: errorResponse("Not found.") } }
      },
      "/admin/account-risk/blacklist": {
        post: { tags: ["Account Risk (V2)"], summary: "Add an address to the blacklist", operationId: "addBlacklistAddress", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Added."), 400: errorResponse("Address required.") } },
        get: { tags: ["Account Risk (V2)"], summary: "List blacklist entries", operationId: "listBlacklist", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Entries.") } }
      },
      "/admin/account-risk/blacklist/check": {
        post: { tags: ["Account Risk (V2)"], summary: "Check an address (hit → review flag)", operationId: "checkBlacklist", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 200: okResponse("Verdict.") } }
      },
      "/admin/account-risk/review-flags": {
        get: { tags: ["Account Risk (V2)"], summary: "List address review flags", operationId: "listReviewFlags", security: [{ bearerAuth: [] }], parameters: [queryParameter("status")], responses: { 200: okResponse("Flags.") } }
      },
      "/admin/account-risk/review-flags/{id}/decide": {
        post: { tags: ["Account Risk (V2)"], summary: "Decide an address review flag", operationId: "decideReviewFlag", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Decided."), 400: errorResponse("Bad decision."), 409: errorResponse("Not pending.") } }
      },
      "/admin/promo-coupons": {
        post: { tags: ["Coupons (V2)"], summary: "Create a coupon (draft)", operationId: "createCoupon", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Created."), 400: errorResponse("Invalid."), 409: errorResponse("Exists.") } },
        get: { tags: ["Coupons (V2)"], summary: "List coupons", operationId: "listCoupons", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Coupons.") } }
      },
      "/admin/promo-coupons/{id}": {
        patch: { tags: ["Coupons (V2)"], summary: "Update mutable fields (frozen rules rejected when active)", operationId: "updateCoupon", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Updated."), 409: errorResponse("Frozen rule.") } }
      },
      "/admin/promo-coupons/{id}/publish": {
        post: { tags: ["Coupons (V2)"], summary: "Publish a coupon (activate)", operationId: "publishCoupon", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Active.") } }
      },
      "/admin/promo-coupons/{id}/disable": {
        post: { tags: ["Coupons (V2)"], summary: "Disable a coupon", operationId: "disableCoupon", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Disabled.") } }
      },
      "/admin/promo-coupons/grant": {
        post: { tags: ["Coupons (V2)"], summary: "Grant a coupon to a user", operationId: "grantCoupon", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Granted."), 409: errorResponse("Quota / limit.") } }
      },
      "/api/v2/promo-coupons": {
        get: { tags: ["Coupons (V2)"], summary: "My coupons", operationId: "listMyCoupons", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Coupons.") } }
      },
      "/api/v2/promo-coupons/redeem": {
        post: { tags: ["Coupons (V2)"], summary: "Redeem a coupon code", operationId: "redeemCoupon", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Redeemed."), 409: errorResponse("Quota / limit.") } }
      },
      "/api/v2/promo-coupons/eligible": {
        get: { tags: ["Coupons (V2)"], summary: "Coupons eligible for a shipment", operationId: "listEligibleCoupons", security: [{ bearerAuth: [] }], parameters: [queryParameter("country"), queryParameter("route_code"), queryParameter("shipping_minor")], responses: { 200: okResponse("Eligible.") } }
      },
      "/admin/banners": {
        post: { tags: ["Banners (V2)"], summary: "Create a banner (draft)", operationId: "createBanner", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Created."), 400: errorResponse("Unsafe link.") } },
        get: { tags: ["Banners (V2)"], summary: "List banners", operationId: "listBanners", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Banners.") } }
      },
      "/admin/banners/{id}": {
        patch: { tags: ["Banners (V2)"], summary: "Update a banner", operationId: "updateBanner", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Updated."), 400: errorResponse("Unsafe link.") } }
      },
      "/admin/banners/{id}/preview": {
        get: { tags: ["Banners (V2)"], summary: "Preview a banner", operationId: "previewBanner", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Preview.") } }
      },
      "/admin/banners/{id}/publish": {
        post: { tags: ["Banners (V2)"], summary: "Publish (requires complete assets + safe link)", operationId: "publishBanner", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Published."), 409: errorResponse("Incomplete / unsafe.") } }
      },
      "/admin/banners/{id}/unpublish": {
        post: { tags: ["Banners (V2)"], summary: "Unpublish a banner", operationId: "unpublishBanner", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Unpublished.") } }
      },
      "/api/v2/banners": {
        get: { tags: ["Banners (V2)"], summary: "Public homepage banners (by language/country/device)", operationId: "listPublicBanners", parameters: [queryParameter("language"), queryParameter("country"), queryParameter("device")], responses: { 200: okResponse("Banners.") } }
      },
      "/admin/email-templates": {
        post: { tags: ["CMS (V2)"], summary: "Create an email template (draft)", operationId: "createEmailTemplate", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Created.") } },
        get: { tags: ["CMS (V2)"], summary: "List email templates", operationId: "listEmailTemplates", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Templates.") } }
      },
      "/admin/email-templates/{id}/publish": {
        post: { tags: ["CMS (V2)"], summary: "Publish a template (undeclared vars blocked)", operationId: "publishEmailTemplate", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Published."), 400: errorResponse("Undeclared variable.") } }
      },
      "/admin/config-docs": {
        post: { tags: ["CMS (V2)"], summary: "Publish a config document version (super-admin, reason required)", operationId: "publishConfigDoc", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Published."), 400: errorResponse("Reason required."), 403: errorResponse("Super-admin only.") } }
      },
      "/admin/config-docs/{kind}/{docKey}/versions": {
        get: { tags: ["CMS (V2)"], summary: "List config document versions", operationId: "listConfigDocVersions", security: [{ bearerAuth: [] }], parameters: [pathParameter("kind"), pathParameter("docKey")], responses: { 200: okResponse("Versions.") } }
      },
      "/admin/config-docs/{kind}/{docKey}/versions/{version}": {
        get: { tags: ["CMS (V2)"], summary: "Get a pinned config document version", operationId: "getConfigDocVersion", security: [{ bearerAuth: [] }], parameters: [pathParameter("kind"), pathParameter("docKey"), pathParameter("version")], responses: { 200: okResponse("Version."), 404: errorResponse("Not found.") } }
      },
      "/api/v2/config-docs/{kind}/{docKey}": {
        get: { tags: ["CMS (V2)"], summary: "Read the active config document", operationId: "getActiveConfigDoc", parameters: [pathParameter("kind"), pathParameter("docKey"), queryParameter("language")], responses: { 200: okResponse("Document."), 404: errorResponse("Not found.") } }
      },
      "/admin/email-campaigns": {
        post: { tags: ["Email Campaigns (V2)"], summary: "Create a campaign (draft)", operationId: "createEmailCampaign", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Created.") } },
        get: { tags: ["Email Campaigns (V2)"], summary: "List campaigns", operationId: "listEmailCampaigns", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Campaigns.") } }
      },
      "/admin/email-campaigns/{id}/schedule": {
        post: { tags: ["Email Campaigns (V2)"], summary: "Schedule (freeze audience snapshot + build batches)", operationId: "scheduleEmailCampaign", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Scheduled."), 400: errorResponse("Audience required."), 409: errorResponse("Not draft.") } }
      },
      "/admin/email-campaigns/{id}/batches": {
        get: { tags: ["Email Campaigns (V2)"], summary: "List a campaign's batches", operationId: "listEmailCampaignBatches", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Batches.") } }
      },
      "/admin/email-campaigns/batches/{batchId}/send": {
        post: { tags: ["Email Campaigns (V2)"], summary: "Send a batch (idempotent)", operationId: "sendEmailBatch", security: [{ bearerAuth: [] }], parameters: [pathParameter("batchId")], responses: { 200: okResponse("Sent.") } }
      },
      "/admin/email-campaigns/{id}/pause": {
        post: { tags: ["Email Campaigns (V2)"], summary: "Pause (only unsent batches)", operationId: "pauseEmailCampaign", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Paused.") } }
      },
      "/admin/email-campaigns/{id}/resume": {
        post: { tags: ["Email Campaigns (V2)"], summary: "Resume paused batches", operationId: "resumeEmailCampaign", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Resumed.") } }
      },
      "/admin/email-campaigns/{id}/stats": {
        get: { tags: ["Email Campaigns (V2)"], summary: "Campaign delivery/open/click stats", operationId: "getEmailCampaignStats", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Stats.") } }
      },
      "/api/v2/email-events": {
        post: { tags: ["Email Campaigns (V2)"], summary: "Provider delivery webhook (idempotent)", operationId: "recordEmailEvent", requestBody: genericRequest(), responses: { 200: okResponse("Recorded."), 401: errorResponse("Bad signature.") } }
      },
      "/api/v2/email-unsubscribe": {
        post: { tags: ["Email Campaigns (V2)"], summary: "Unsubscribe an email", operationId: "unsubscribeEmail", requestBody: genericRequest(), responses: { 200: okResponse("Unsubscribed.") } }
      },
      "/admin/support/conversations": {
        get: { tags: ["Support (V2)"], summary: "List support conversations (paged 20/50/100)", operationId: "listSupportConversations", security: [{ bearerAuth: [] }], parameters: [queryParameter("status"), queryParameter("limit")], responses: { 200: okResponse("Conversations.") } },
        post: { tags: ["Support (V2)"], summary: "Create a conversation", operationId: "createSupportConversation", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Created.") } }
      },
      "/admin/support/conversations/{id}": {
        get: { tags: ["Support (V2)"], summary: "Get a conversation (thread + metrics)", operationId: "getSupportConversation", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Conversation."), 404: errorResponse("Not found.") } }
      },
      "/admin/support/conversations/{id}/claim": {
        post: { tags: ["Support (V2)"], summary: "Claim (single owner)", operationId: "claimSupportConversation", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Claimed."), 409: errorResponse("Already claimed.") } }
      },
      "/admin/support/conversations/{id}/transfer": {
        post: { tags: ["Support (V2)"], summary: "Transfer to another agent", operationId: "transferSupportConversation", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Transferred.") } }
      },
      "/admin/support/conversations/{id}/reply": {
        post: { tags: ["Support (V2)"], summary: "Reply on the original channel", operationId: "replySupportConversation", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Replied.") } }
      },
      "/admin/support/conversations/{id}/resolve": {
        post: { tags: ["Support (V2)"], summary: "Resolve a conversation", operationId: "resolveSupportConversation", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Resolved.") } }
      },
      "/admin/support/conversations/{id}/reopen": {
        post: { tags: ["Support (V2)"], summary: "Reopen a conversation", operationId: "reopenSupportConversation", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Reopened.") } }
      },
      "/admin/support/conversations/{id}/link-after-sales": {
        post: { tags: ["Support (V2)"], summary: "Link to an after-sales order (read-only, no state change)", operationId: "linkSupportAfterSales", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Linked.") } }
      },
      "/api/v2/support/inbound": {
        post: { tags: ["Support (V2)"], summary: "Inbound email/chat webhook (idempotent auto-link)", operationId: "ingestSupportInbound", requestBody: genericRequest(), responses: { 200: okResponse("Threaded."), 401: errorResponse("Bad signature.") } }
      },
      "/admin/notifications/catalog": {
        get: { tags: ["Notifications (V2)"], summary: "Notification + cron catalog", operationId: "getNotificationCatalog", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Catalog.") } }
      },
      "/admin/notifications/dead-letters": {
        get: { tags: ["Notifications (V2)"], summary: "Dead-lettered notifications", operationId: "listNotificationDeadLetters", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Dead letters.") } }
      },
      "/api/v2/referral/code": {
        get: { tags: ["Referral (V2)"], summary: "My referral code + link + QR payload", operationId: "getReferralCode", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Code.") } }
      },
      "/api/v2/referral": {
        get: { tags: ["Referral (V2)"], summary: "My referral summary (code + invitee count)", operationId: "getReferral", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Referral.") } }
      },
      "/api/v2/referral/lookup": {
        get: { tags: ["Referral (V2)"], summary: "Check a referral code's validity", operationId: "lookupReferralCode", parameters: [queryParameter("code")], responses: { 200: okResponse("Valid."), 404: errorResponse("Not found.") } }
      },
      "/api/v2/referral/level": {
        get: { tags: ["Referral (V2)"], summary: "My promoter level + commission rate", operationId: "getReferralLevel", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Level.") } }
      },
      "/admin/referral/tiers": {
        post: { tags: ["Referral (V2)"], summary: "Publish a promotion tier config (super-admin)", operationId: "publishReferralTiers", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Published."), 400: errorResponse("Invalid ladder."), 403: errorResponse("Super-admin only.") } },
        get: { tags: ["Referral (V2)"], summary: "Active promotion tier config", operationId: "getReferralTiers", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Config.") } }
      },
      "/admin/referral/tiers/versions": {
        get: { tags: ["Referral (V2)"], summary: "List tier config versions", operationId: "listReferralTierVersions", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Versions.") } }
      },
      "/api/v2/commission/wallet": {
        get: { tags: ["Commission (V2)"], summary: "My commission wallet (pending/available/frozen/settled)", operationId: "getCommissionWallet", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Wallet.") } }
      },
      "/api/v2/commission/transactions": {
        get: { tags: ["Commission (V2)"], summary: "My commission transactions", operationId: "listCommissionTransactions", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Transactions.") } }
      },
      "/api/v2/commission/dashboard": {
        get: { tags: ["Commission (V2)"], summary: "Promoter privacy dashboard (aggregate + masked)", operationId: "getCommissionDashboard", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Dashboard.") } }
      },
      "/api/v2/commission/transfer": {
        post: { tags: ["Commission (V2)"], summary: "Transfer commission to the normal wallet (zero-fee, idempotent)", operationId: "transferCommission", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 200: okResponse("Transferred."), 400: errorResponse("Bad amount."), 409: errorResponse("Insufficient available.") } }
      },
      "/api/v2/commission/withdrawals": {
        post: { tags: ["Commission (V2)"], summary: "Request a bank withdrawal (min 2000 CNY)", operationId: "requestCommissionWithdrawal", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Requested."), 400: errorResponse("Below minimum."), 409: errorResponse("Insufficient / frozen.") } }
      },
      "/admin/commission/withdrawals": {
        get: { tags: ["Commission (V2)"], summary: "List commission withdrawals", operationId: "listCommissionWithdrawals", security: [{ bearerAuth: [] }], parameters: [queryParameter("status")], responses: { 200: okResponse("Withdrawals.") } }
      },
      "/admin/commission/withdrawals/{id}/review": {
        post: { tags: ["Commission (V2)"], summary: "Review a withdrawal (approve/reject)", operationId: "reviewCommissionWithdrawal", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Reviewed."), 409: errorResponse("Not pending.") } }
      },
      "/admin/commission/withdrawals/{id}/pay": {
        post: { tags: ["Commission (V2)"], summary: "Pay a withdrawal (idempotent)", operationId: "payCommissionWithdrawal", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Paid."), 409: errorResponse("Not processing.") } }
      },
      "/admin/commission/withdrawals/{id}/fail": {
        post: { tags: ["Commission (V2)"], summary: "Fail a withdrawal (unfreezes)", operationId: "failCommissionWithdrawal", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], requestBody: genericRequest(), responses: { 200: okResponse("Failed."), 409: errorResponse("Not processing.") } }
      },
      "/admin/commission/discipline": {
        post: { tags: ["Commission (V2)"], summary: "Freeze / unfreeze / disqualify a promoter", operationId: "disciplineCommission", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 200: okResponse("Applied."), 400: errorResponse("Reason/evidence/confirm required.") } }
      },
      "/admin/commission/clawback": {
        post: { tags: ["Commission (V2)"], summary: "Claw back commission on a refund (once, ≤ original)", operationId: "clawbackCommission", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 200: okResponse("Clawed.") } }
      },
      "/admin/jobs/dead-letters": {
        get: { tags: ["Infra (V2)"], summary: "List dead-lettered jobs", operationId: "listDeadLetterJobs", security: [{ bearerAuth: [] }], parameters: [queryParameter("status")], responses: { 200: okResponse("Dead letters.") } }
      },
      "/admin/jobs/dead-letters/{id}/replay": {
        post: { tags: ["Infra (V2)"], summary: "Replay a dead-lettered job (super-admin, audited)", operationId: "replayDeadLetterJob", security: [{ bearerAuth: [] }], parameters: [pathParameter("id")], responses: { 200: okResponse("Replayed."), 403: errorResponse("Super-admin only."), 409: errorResponse("Not dead.") } }
      },
      "/admin/jobs/health": {
        get: { tags: ["Infra (V2)"], summary: "Job backlog / dead-letter health signal", operationId: "getJobHealth", security: [{ bearerAuth: [] }], responses: { 200: okResponse("Health.") } }
      },
      "/storage/private/{key}": {
        get: {
          tags: ["Warehouse / QC"],
          summary: "Read a private storage object with a signed URL",
          operationId: "getPrivateStorageObject",
          parameters: [
            pathParameter("key"),
            {
              name: "expires",
              in: "query",
              required: true,
              schema: { type: "integer" }
            },
            {
              name: "signature",
              in: "query",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            200: {
              description: "Private object bytes.",
              content: {
                "application/octet-stream": {
                  schema: { type: "string", format: "binary" }
                }
              }
            },
            403: errorResponse("Signed URL is invalid or expired."),
            404: errorResponse("Storage object not found.")
          }
        }
      },
      "/shipping-lines": {
        get: {
          tags: ["Shipping"],
          summary: "List shipping lines",
          operationId: "listShippingLines",
          parameters: [
            {
              name: "country",
              in: "query",
              required: false,
              schema: { type: "string" }
            }
          ],
          responses: {
            200: jsonResponse("Shipping lines.", "ShippingLinesResponse")
          }
        }
      },
      "/parcels": {
        get: {
          tags: ["Shipping"],
          summary: "List current user's parcels",
          operationId: "listParcels",
          security: [{ bearerAuth: [] }],
          responses: {
            200: jsonResponse("Parcels.", "ParcelsResponse"),
            401: errorResponse("Bearer token missing or invalid.")
          }
        },
        post: {
          tags: ["Shipping"],
          summary: "Submit a draft parcel with a fresh shipping quote",
          operationId: "submitParcel",
          security: [{ bearerAuth: [] }],
          requestBody: jsonRequest("ParcelSubmitRequest"),
          responses: {
            201: jsonResponse("Parcel submitted.", "ParcelEnvelope"),
            200: jsonResponse("Parcel was already submitted with this quote.", "ParcelEnvelope"),
            400: errorResponse("Address input is invalid."),
            401: errorResponse("Bearer token missing or invalid."),
            404: errorResponse("Parcel or quote not found."),
            409: errorResponse("Quote expired or parcel cannot be submitted.")
          }
        }
      },
      "/parcels/draft": {
        post: {
          tags: ["Shipping"],
          summary: "Create a parcel draft from ready warehouse items",
          operationId: "createParcelDraft",
          security: [{ bearerAuth: [] }],
          requestBody: jsonRequest("ParcelDraftRequest"),
          responses: {
            201: jsonResponse("Parcel draft created.", "ParcelEnvelope"),
            200: jsonResponse("Parcel draft already exists.", "ParcelEnvelope"),
            400: errorResponse("Invalid item list."),
            401: errorResponse("Bearer token missing or invalid."),
            404: errorResponse("Warehouse item not found."),
            409: errorResponse("Item is not ready or already reserved.")
          }
        }
      },
      "/shipping/preview": {
        post: {
          tags: ["Shipping"],
          summary: "Preview available and unavailable shipping quotes",
          operationId: "previewShipping",
          security: [{ bearerAuth: [] }],
          requestBody: jsonRequest("ShippingPreviewRequest"),
          responses: {
            200: jsonResponse("Shipping preview.", "ShippingPreviewResponse"),
            400: errorResponse("Invalid preview input."),
            401: errorResponse("Bearer token missing or invalid."),
            404: errorResponse("Parcel or item not found."),
            409: errorResponse("Parcel or item cannot be previewed.")
          }
        }
      },
      "/shipping-payments": {
        post: {
          tags: ["Shipping"],
          summary: "Create a shipping payment intent",
          operationId: "createShippingPayment",
          security: [{ bearerAuth: [] }],
          requestBody: jsonRequest("ShippingPaymentRequest"),
          responses: {
            201: jsonResponse("Shipping payment created.", "ShippingPaymentEnvelope"),
            200: jsonResponse("Shipping payment idempotency key already exists.", "ShippingPaymentEnvelope"),
            400: errorResponse("Invalid payment input."),
            401: errorResponse("Bearer token missing or invalid."),
            404: errorResponse("Parcel not found."),
            409: errorResponse("Parcel is not payable.")
          }
        }
      },
      "/webhooks/shipping-payments": {
        post: {
          tags: ["Shipping"],
          summary: "Handle signed shipping payment webhook",
          operationId: "handleShippingPaymentWebhook",
          parameters: [
            {
              name: "x-goatedbuy-signature",
              in: "header",
              required: true,
              schema: { type: "string" }
            }
          ],
          requestBody: jsonRequest("ShippingPaymentWebhookRequest"),
          responses: {
            202: jsonResponse("Webhook applied.", "ShippingWebhookResponse"),
            200: jsonResponse("Webhook event was already applied.", "ShippingWebhookResponse"),
            400: errorResponse("Invalid webhook payload."),
            403: errorResponse("Webhook signature is invalid."),
            404: errorResponse("Shipping payment not found."),
            409: errorResponse("Webhook amount mismatch.")
          }
        }
      },
      "/parcels/{id}/tracking": {
        get: {
          tags: ["Shipping"],
          summary: "Get parcel tracking events",
          operationId: "getParcelTracking",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("id")],
          responses: {
            200: jsonResponse("Parcel tracking.", "TrackingResponse"),
            401: errorResponse("Bearer token missing or invalid."),
            404: errorResponse("Parcel not found.")
          }
        }
      },
      "/admin/parcels/{id}/status": {
        patch: {
          tags: ["Shipping"],
          summary: "Update parcel shipment status",
          operationId: "updateAdminParcelStatus",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("id")],
          requestBody: jsonRequest("AdminParcelStatusRequest"),
          responses: {
            200: jsonResponse("Parcel status updated.", "ParcelEnvelope"),
            400: errorResponse("Invalid status update input."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks shipping write permission."),
            404: errorResponse("Parcel not found."),
            409: errorResponse("Illegal parcel status transition.")
          }
        }
      },
      "/wallet": {
        get: {
          tags: ["Wallet / Coupons"],
          summary: "Get current user's wallet, transactions, and coupons",
          operationId: "getWallet",
          security: [{ bearerAuth: [] }],
          responses: {
            200: jsonResponse("Wallet state.", "WalletResponse"),
            401: errorResponse("Bearer token missing or invalid.")
          }
        }
      },
      "/coupons/redeem-code": {
        post: {
          tags: ["Wallet / Coupons"],
          summary: "Redeem a coupon code",
          operationId: "redeemCouponCode",
          security: [{ bearerAuth: [] }],
          requestBody: jsonRequest("RedeemCouponRequest"),
          responses: {
            201: jsonResponse("Coupon redeemed.", "UserCouponEnvelope"),
            400: errorResponse("Invalid coupon code input."),
            401: errorResponse("Bearer token missing or invalid."),
            404: errorResponse("Coupon code not found."),
            409: errorResponse("Coupon is expired, inactive, duplicate, or fully redeemed.")
          }
        }
      },
      "/welcome-gift/claim": {
        post: {
          tags: ["Wallet / Coupons"],
          summary: "Claim the Welcome Gift coupon",
          operationId: "claimWelcomeGift",
          security: [{ bearerAuth: [] }],
          responses: {
            201: jsonResponse("Welcome Gift claimed.", "WelcomeGiftClaimEnvelope"),
            200: jsonResponse("Welcome Gift was already claimed.", "WelcomeGiftClaimEnvelope"),
            401: errorResponse("Bearer token missing or invalid."),
            409: errorResponse("Welcome Gift is disabled.")
          }
        }
      },
      "/checkout/apply-coupon": {
        post: {
          tags: ["Wallet / Coupons"],
          summary: "Lock a coupon against a shipping checkout",
          operationId: "applyCheckoutCoupon",
          security: [{ bearerAuth: [] }],
          requestBody: jsonRequest("ApplyCouponRequest"),
          responses: {
            201: jsonResponse("Coupon locked for checkout.", "CouponApplicationEnvelope"),
            200: jsonResponse("Coupon was already locked for this checkout.", "CouponApplicationEnvelope"),
            401: errorResponse("Bearer token missing or invalid."),
            404: errorResponse("Parcel or coupon not found."),
            409: errorResponse("Coupon is not eligible for this checkout.")
          }
        }
      },
      "/admin/promo-coupons": {
        post: {
          tags: ["Wallet / Coupons"],
          summary: "Create or update a coupon definition",
          operationId: "createAdminCoupon",
          security: [{ bearerAuth: [] }],
          requestBody: jsonRequest("AdminCouponRequest"),
          responses: {
            201: jsonResponse("Coupon created or updated.", "AdminCouponEnvelope"),
            400: errorResponse("Invalid coupon input."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks operations or finance permission.")
          }
        }
      },
      "/admin/coupons": {
        post: { tags: ["Wallet / Coupons"], summary: "Create a V1 wallet coupon (legacy shipping/welcome coupon)", operationId: "createWalletCoupon", security: [{ bearerAuth: [] }], requestBody: genericRequest(), responses: { 201: okResponse("Created."), 409: errorResponse("Exists.") } }
      },
      "/admin/wallets/{userId}/credit": {
        patch: {
          tags: ["Wallet / Coupons"],
          summary: "Adjust a user's wallet credit",
          operationId: "adjustWalletCredit",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("userId")],
          requestBody: jsonRequest("WalletCreditRequest"),
          responses: {
            200: jsonResponse("Wallet credit adjusted.", "WalletCreditResponse"),
            400: errorResponse("Invalid credit input or missing reason."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks finance permission."),
            409: errorResponse("Wallet balance cannot go below zero.")
          }
        }
      },
      "/creator-campaign/touch": {
        post: {
          tags: ["Creators"],
          summary: "Record a creator/campaign attribution touch",
          operationId: "recordCreatorTouch",
          description: "Public. Optionally attributes the authenticated user. Never stores or returns session/user identifiers.",
          requestBody: genericRequest(),
          responses: {
            201: okResponse("Attribution touch recorded."),
            400: errorResponse("campaign_code or creator_code is required."),
            404: errorResponse("Creator or campaign not found."),
            503: errorResponse("Creators feature is disabled.")
          }
        }
      },
      "/creator/dashboard": {
        get: {
          tags: ["Creators"],
          summary: "Get the current user's creator dashboard",
          operationId: "getCreatorDashboard",
          security: [{ bearerAuth: [] }],
          responses: {
            200: okResponse("Aggregate creator dashboard (no buyer PII)."),
            401: errorResponse("Bearer token missing or invalid."),
            403: errorResponse("Current user is not a registered creator."),
            503: errorResponse("Creators feature is disabled.")
          }
        }
      },
      "/admin/creators": {
        post: {
          tags: ["Creators"],
          summary: "Register a creator",
          operationId: "createCreator",
          security: [{ bearerAuth: [] }],
          requestBody: genericRequest(),
          responses: {
            201: okResponse("Creator created."),
            400: errorResponse("Invalid creator input."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks operations permission.")
          }
        }
      },
      "/admin/creators/{id}/campaigns": {
        post: {
          tags: ["Creators"],
          summary: "Create a creator campaign",
          operationId: "createCreatorCampaign",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("id")],
          requestBody: genericRequest(),
          responses: {
            201: okResponse("Campaign created."),
            400: errorResponse("Invalid campaign input."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks operations permission."),
            404: errorResponse("Creator not found.")
          }
        }
      },
      "/haul-stories": {
        get: {
          tags: ["Content"],
          summary: "List the current user's Haul Stories",
          operationId: "listMyHaulStories",
          security: [{ bearerAuth: [] }],
          responses: {
            200: okResponse("User Haul Stories."),
            401: errorResponse("Bearer token missing or invalid.")
          }
        },
        post: {
          tags: ["Content"],
          summary: "Create a Haul Story",
          operationId: "createHaulStory",
          description: "Only title/body/privacy are accepted. Stories always start pending review.",
          security: [{ bearerAuth: [] }],
          requestBody: genericRequest(),
          responses: {
            201: okResponse("Story created (pending review)."),
            400: errorResponse("Invalid story input."),
            401: errorResponse("Bearer token missing or invalid.")
          }
        }
      },
      "/haul-stories/{id}/withdraw": {
        post: {
          tags: ["Content"],
          summary: "Withdraw a Haul Story",
          operationId: "withdrawHaulStory",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("id")],
          responses: {
            201: okResponse("Story withdrawn."),
            200: okResponse("Story was already withdrawn."),
            401: errorResponse("Bearer token missing or invalid."),
            404: errorResponse("Story not found.")
          }
        }
      },
      "/admin/content-review": {
        get: {
          tags: ["Content"],
          summary: "List the content moderation queue",
          operationId: "listContentReview",
          security: [{ bearerAuth: [] }],
          parameters: [queryParameter("status"), queryParameter("limit"), queryParameter("offset")],
          responses: {
            200: okResponse("Content review queue."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks content:review:write permission.")
          }
        }
      },
      "/admin/content-review/{id}/action": {
        post: {
          tags: ["Content"],
          summary: "Approve, reject, or hide a Haul Story",
          operationId: "reviewHaulStory",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("id")],
          requestBody: genericRequest(),
          responses: {
            200: okResponse("Story reviewed."),
            400: errorResponse("Invalid action or missing reason."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks content:review:write permission."),
            404: errorResponse("Story not found."),
            409: errorResponse("Story was withdrawn.")
          }
        }
      },
      "/admin/risk-cases": {
        get: {
          tags: ["Risk"],
          summary: "List risk cases",
          operationId: "listRiskCases",
          security: [{ bearerAuth: [] }],
          parameters: [queryParameter("status"), queryParameter("limit"), queryParameter("offset")],
          responses: {
            200: okResponse("Risk cases."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks risk:case:write permission.")
          }
        },
        post: {
          tags: ["Risk"],
          summary: "Open a risk case",
          operationId: "createRiskCase",
          security: [{ bearerAuth: [] }],
          requestBody: genericRequest(),
          responses: {
            201: okResponse("Risk case created."),
            400: errorResponse("Invalid risk case input."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks risk:case:write permission.")
          }
        }
      },
      "/admin/risk-cases/{id}": {
        patch: {
          tags: ["Risk"],
          summary: "Update a risk case",
          operationId: "updateRiskCase",
          security: [{ bearerAuth: [] }],
          parameters: [pathParameter("id")],
          requestBody: genericRequest(),
          responses: {
            200: okResponse("Risk case updated."),
            400: errorResponse("Invalid input or illegal status transition."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks risk:case:write permission."),
            404: errorResponse("Risk case not found.")
          }
        }
      },
      "/country-shipping/{country}": {
        get: {
          tags: ["Country Shipping"],
          summary: "Get published country shipping rules",
          operationId: "getCountryShipping",
          description: "Public. Returns only the latest published version and flags expired content.",
          parameters: [pathParameter("country")],
          responses: {
            200: okResponse("Published country shipping rules."),
            404: errorResponse("Country shipping rules are not published.")
          }
        }
      },
      "/admin/country-shipping": {
        get: {
          tags: ["Country Shipping"],
          summary: "List country shipping rules",
          operationId: "listCountryShipping",
          security: [{ bearerAuth: [] }],
          parameters: [queryParameter("country")],
          responses: {
            200: okResponse("Country shipping rules."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks operations permission.")
          }
        },
        put: {
          tags: ["Country Shipping"],
          summary: "Create or update a country shipping rule version",
          operationId: "upsertCountryShipping",
          security: [{ bearerAuth: [] }],
          requestBody: genericRequest(),
          responses: {
            200: okResponse("Country shipping rule saved."),
            400: errorResponse("Invalid country rule input."),
            401: errorResponse("Admin bearer token missing or invalid."),
            403: errorResponse("Admin lacks operations permission.")
          }
        }
      },
      "/health": {
        get: {
          tags: ["System"],
          summary: "Liveness check",
          operationId: "getHealth",
          responses: {
            200: jsonResponse("Service is alive.", "HealthResponse")
          }
        }
      },
      "/ready": {
        get: {
          tags: ["System"],
          summary: "Readiness check",
          operationId: "getReady",
          responses: {
            200: jsonResponse("Required dependencies are ready.", "ReadyResponse"),
            503: errorResponse("Required dependency is not ready.")
          }
        }
      },
      "/version": {
        get: {
          tags: ["System"],
          summary: "Release version",
          operationId: "getVersion",
          responses: {
            200: jsonResponse("Service version metadata.", "VersionResponse")
          }
        }
      },
      "/openapi.json": {
        get: {
          tags: ["System"],
          summary: "OpenAPI document",
          operationId: "getOpenApiDocument",
          responses: {
            200: {
              description: "OpenAPI 3.1 document.",
              content: {
                "application/json": {
                  schema: {
                    type: "object"
                  }
                }
              }
            }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer"
        }
      },
      schemas: {
        RegisterRequest: objectSchema({
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 10, maxLength: 128 },
          display_name: { type: "string", maxLength: 80 }
        }, ["email", "password"]),
        LoginRequest: objectSchema({
          email: { type: "string", format: "email" },
          password: { type: "string" }
        }, ["email", "password"]),
        EmailRequest: objectSchema({ email: { type: "string", format: "email" } }, ["email"]),
        TokenRequest: objectSchema({ token: { type: "string" }, device_label: { type: "string", maxLength: 80 } }, ["token"]),
        RegistrationResponse: objectSchema({
          user: { $ref: "#/components/schemas/User" },
          verification_required: { const: true },
          verification_token: { type: "string", description: "Only exposed outside production for test delivery." }
        }, ["user", "verification_required"]),
        VerificationResponse: objectSchema({
          user: { $ref: "#/components/schemas/User" }, verified: { const: true }, idempotent: { type: "boolean" }
        }, ["user", "verified", "idempotent"]),
        VerificationAcceptedResponse: objectSchema({ accepted: { const: true }, verification_required: { type: "boolean" } }, ["accepted"]),
        V2Meta: objectSchema({ request_id: { type: "string" } }, ["request_id"]),
        V2Account: objectSchema({
          email: { type: "string", format: "email" }, display_name: { type: "string" },
          phone: { type: ["string", "null"] }, phone_verified: { type: "boolean" },
          country_code: { type: ["string", "null"] }, default_locale: { type: "string" },
          default_currency: { type: "string", pattern: "^[A-Z]{3}$" }, status: { type: "string" },
          email_verified: { type: "boolean" }, version: { type: "integer", minimum: 1 },
          deletion_requested_at: { type: ["string", "null"], format: "date-time" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["email", "display_name", "phone_verified", "default_locale", "default_currency", "status", "email_verified", "version"]),
        V2AccountEnvelope: objectSchema({ data: { $ref: "#/components/schemas/V2Account" }, meta: { $ref: "#/components/schemas/V2Meta" } }, ["data", "meta"]),
        V2AccountUpdateRequest: objectSchema({
          display_name: { type: "string", maxLength: 80 }, phone: { type: ["string", "null"], maxLength: 32 },
          country_code: { type: ["string", "null"], pattern: "^[A-Z]{2}$" }, default_locale: { type: "string" },
          default_currency: { type: "string", pattern: "^[A-Z]{3}$" }, expected_version: { type: "integer", minimum: 1 }
        }, ["expected_version"]),
        V2PasswordChangeRequest: objectSchema({
          current_password: { type: "string" }, new_password: { type: "string", minLength: 10, maxLength: 128 },
          expected_version: { type: "integer", minimum: 1 }
        }, ["current_password", "new_password", "expected_version"]),
        V2Address: objectSchema({
          id: { type: "string", format: "uuid" }, recipient_name: { type: "string" }, phone: { type: "string" },
          country_code: { type: "string", pattern: "^[A-Z]{2}$" }, region: { type: "string" }, city: { type: "string" },
          postal_code: { type: "string" }, line1: { type: "string" }, line2: { type: "string" },
          is_default: { type: "boolean" }, version: { type: "integer", minimum: 1 },
          created_at: { type: ["string", "null"], format: "date-time" }, updated_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "recipient_name", "phone", "country_code", "city", "postal_code", "line1", "is_default", "version"]),
        V2AddressWriteRequest: objectSchema({
          recipient_name: { type: "string", maxLength: 120 }, phone: { type: "string", maxLength: 32 },
          country_code: { type: "string", pattern: "^[A-Z]{2}$" }, region: { type: "string", maxLength: 120 },
          city: { type: "string", maxLength: 120 }, postal_code: { type: "string", maxLength: 32 },
          line1: { type: "string", maxLength: 240 }, line2: { type: "string", maxLength: 240 }, is_default: { type: "boolean" }
        }, ["recipient_name", "phone", "country_code", "city", "postal_code", "line1"]),
        V2AddressUpdateRequest: objectSchema({
          recipient_name: { type: "string", maxLength: 120 }, phone: { type: "string", maxLength: 32 },
          country_code: { type: "string", pattern: "^[A-Z]{2}$" }, region: { type: "string", maxLength: 120 },
          city: { type: "string", maxLength: 120 }, postal_code: { type: "string", maxLength: 32 },
          line1: { type: "string", maxLength: 240 }, line2: { type: "string", maxLength: 240 },
          is_default: { type: "boolean" }, expected_version: { type: "integer", minimum: 1 }
        }, ["recipient_name", "phone", "country_code", "city", "postal_code", "line1", "expected_version"]),
        V2AddressEnvelope: objectSchema({ data: { $ref: "#/components/schemas/V2Address" }, meta: { $ref: "#/components/schemas/V2Meta" } }, ["data", "meta"]),
        V2AddressListEnvelope: objectSchema({ data: { type: "array", items: { $ref: "#/components/schemas/V2Address" } }, meta: { $ref: "#/components/schemas/V2Meta" } }, ["data", "meta"]),
        V2ActionEnvelope: objectSchema({ data: { type: "object", additionalProperties: true }, meta: { $ref: "#/components/schemas/V2Meta" } }, ["data", "meta"]),
        V2DeletionEligibilityEnvelope: objectSchema({
          data: objectSchema({ eligible: { type: "boolean" }, blockers: { type: "object", additionalProperties: true } }, ["eligible", "blockers"]),
          meta: { $ref: "#/components/schemas/V2Meta" }
        }, ["data", "meta"]),
        V2DeletionRequestEnvelope: objectSchema({
          data: objectSchema({ deletion_request: { type: "object", additionalProperties: true }, existing: { type: "boolean" } }, ["deletion_request", "existing"]),
          meta: { $ref: "#/components/schemas/V2Meta" }
        }, ["data", "meta"]),
        RefreshRequest: objectSchema({
          refresh_token: { type: "string" }
        }, ["refresh_token"]),
        AuthResponse: objectSchema({
          user: { $ref: "#/components/schemas/User" },
          session: { $ref: "#/components/schemas/SessionTokens" }
        }, ["user", "session"]),
        AdminAuthResponse: objectSchema({
          admin_user: { $ref: "#/components/schemas/AdminUser" },
          roles: { type: "array", items: { type: "string" } },
          permissions: { type: "array", items: { type: "string" } },
          session: { $ref: "#/components/schemas/SessionTokens" }
        }, ["admin_user", "roles", "permissions", "session"]),
        AdminChallengeRequest: objectSchema({ challenge_token: { type: "string" } }, ["challenge_token"]),
        AdminChallengeResponse: objectSchema({
          mfa_required: { const: true }, setup_required: { type: "boolean" }, challenge_token: { type: "string" }
        }, ["mfa_required", "setup_required", "challenge_token"]),
        AdminTotpRequest: objectSchema({
          challenge_token: { type: "string" }, code: { type: "string", pattern: "^[0-9]{6}$" }, recovery_code: { type: "string" }
        }, ["challenge_token"]),
        TotpSetupResponse: objectSchema({ secret: { type: "string" }, otpauth_uri: { type: "string" } }, ["secret", "otpauth_uri"]),
        AdminReauthRequest: objectSchema({
          action: { type: "string" }, reason: { type: "string", maxLength: 500 }, code: { type: "string" }, recovery_code: { type: "string" },
          resource_type: { type: "string" }, resource_id: { type: "string" }
        }, ["action", "reason"]),
        AdminReauthResponse: objectSchema({
          reauth_token: { type: "string" }, expires_at: { type: "string", format: "date-time" }
        }, ["reauth_token", "expires_at"]),
        AdminRoleRequest: objectSchema({ role_code: { type: "string" } }, ["role_code"]),
        AdminRoleResponse: objectSchema({ admin_user_id: { type: "string", format: "uuid" }, role_code: { type: "string" } }, ["admin_user_id", "role_code"]),
        MeResponse: objectSchema({
          user: { $ref: "#/components/schemas/User" }
        }, ["user"]),
        AdminMeResponse: objectSchema({
          admin_user: { $ref: "#/components/schemas/AdminUser" },
          roles: { type: "array", items: { type: "string" } },
          permissions: { type: "array", items: { type: "string" } }
        }, ["admin_user", "roles", "permissions"]),
        AdminOverviewResponse: objectSchema({
          overview: { $ref: "#/components/schemas/AdminOverview" }
        }, ["overview"]),
        AdminOverview: objectSchema({
          admin_user_id: { type: "string", format: "uuid" },
          visible: { type: "array", items: { type: "string", enum: ["orders", "warehouse", "parcels", "policies"] } },
          counts: { $ref: "#/components/schemas/AdminOverviewCounts" }
        }, ["admin_user_id", "visible", "counts"]),
        AdminOverviewCounts: objectSchema({
          orders: { $ref: "#/components/schemas/AdminOrderCountBucket" },
          warehouse: { $ref: "#/components/schemas/AdminWarehouseCountBucket" },
          parcels: { $ref: "#/components/schemas/AdminParcelCountBucket" },
          policies: { $ref: "#/components/schemas/AdminPolicyCountBucket" }
        }),
        AdminOrderCountBucket: objectSchema({
          total: { type: "integer" },
          submitted: { type: "integer" },
          purchasing: { type: "integer" },
          seller_shipped: { type: "integer" },
          arrived: { type: "integer" },
          qc_ready: { type: "integer" },
          exceptions: { type: "integer" },
          cancelled: { type: "integer" }
        }, ["total"]),
        AdminWarehouseCountBucket: objectSchema({
          total: { type: "integer" },
          received: { type: "integer" },
          qc_pending: { type: "integer" },
          qc_ready: { type: "integer" },
          extra_photo_requested: { type: "integer" },
          ready_to_ship: { type: "integer" }
        }, ["total"]),
        AdminParcelCountBucket: objectSchema({
          total: { type: "integer" },
          draft: { type: "integer" },
          shipping_due: { type: "integer" },
          payment_pending: { type: "integer" },
          paid: { type: "integer" },
          processing: { type: "integer" },
          dispatched: { type: "integer" },
          in_transit: { type: "integer" },
          delivered: { type: "integer" },
          cancelled: { type: "integer" }
        }, ["total"]),
        AdminPolicyCountBucket: objectSchema({
          total: { type: "integer" },
          draft: { type: "integer" },
          published: { type: "integer" },
          archived: { type: "integer" }
        }, ["total"]),
        AdminPagination: objectSchema({
          total: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1 },
          offset: { type: "integer", minimum: 0 },
          has_more: { type: "boolean" }
        }, ["total", "limit", "offset", "has_more"]),
        AdminOrdersResponse: objectSchema({
          orders: { type: "array", items: { $ref: "#/components/schemas/AdminOrder" } },
          pagination: { $ref: "#/components/schemas/AdminPagination" }
        }, ["orders", "pagination"]),
        AdminOrderEnvelope: objectSchema({
          order: { $ref: "#/components/schemas/AdminOrder" },
          existing: { type: "boolean" }
        }, ["order"]),
        AdminOrderStatusRequest: objectSchema({
          status: { type: "string", enum: ["submitted", "purchasing", "seller_shipped", "arrived", "qc_ready", "cancelled"] },
          external_order_no: { type: "string", maxLength: 120 },
          reason: { type: "string", maxLength: 500 }
        }, ["status"]),
        AdminOrderExceptionRequest: objectSchema({
          exception: { type: "string", maxLength: 500 },
          reason: { type: "string", maxLength: 500 }
        }),
        AdminOrder: objectSchema({
          id: { type: "string", format: "uuid" },
          user_id: { type: "string", format: "uuid" },
          user_email: { type: "string", format: "email" },
          haul_item_id: { type: "string", format: "uuid" },
          title: { type: "string" },
          spec: { type: "string" },
          price_cents: { type: ["integer", "null"] },
          price: { type: ["number", "null"] },
          currency: { type: "string" },
          quantity: { type: "integer" },
          source_platform: { type: "string" },
          source_domain: { type: "string" },
          status: { type: "string" },
          email_verified: { type: "boolean" },
          haul_status: { type: "string" },
          exception: { type: "string" },
          external_order_no: { type: "string" },
          created_at: { type: ["string", "null"], format: "date-time" },
          updated_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "user_id", "haul_item_id", "title", "status"]),
        AdminWarehouseItemsResponse: objectSchema({
          items: { type: "array", items: { $ref: "#/components/schemas/AdminWarehouseItem" } },
          pagination: { $ref: "#/components/schemas/AdminPagination" }
        }, ["items", "pagination"]),
        AdminWarehouseItem: objectSchema({
          id: { type: "string", format: "uuid" },
          user_id: { type: "string", format: "uuid" },
          user_email: { type: "string", format: "email" },
          purchase_order_id: { type: "string", format: "uuid" },
          haul_item_id: { type: "string", format: "uuid" },
          title: { type: "string" },
          spec: { type: "string" },
          status: { type: "string" },
          employee_no: { type: ["string", "null"] },
          department_code: { type: ["string", "null"] },
          organization_code: { type: ["string", "null"] },
          totp_enabled: { type: "boolean" },
          haul_status: { type: "string" },
          order_status: { type: "string" },
          storage_location: { type: "string" },
          weight_grams: { type: ["integer", "null"] },
          weight_kg: { type: ["number", "null"] },
          free_storage_days: { type: "integer" },
          photo_count: { type: "integer" },
          received_at: { type: ["string", "null"], format: "date-time" },
          created_at: { type: ["string", "null"], format: "date-time" },
          updated_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "user_id", "purchase_order_id", "haul_item_id", "status"]),
        AdminParcelsResponse: objectSchema({
          parcels: { type: "array", items: { $ref: "#/components/schemas/AdminParcel" } },
          pagination: { $ref: "#/components/schemas/AdminPagination" },
          redacted: { type: "boolean" }
        }, ["parcels", "pagination", "redacted"]),
        AdminParcel: objectSchema({
          id: { type: "string", format: "uuid" },
          user_id: { type: "string", format: "uuid" },
          user_email: { type: "string", format: "email" },
          status: { type: "string" },
          destination_country: { type: "string" },
          recipient_name: { type: "string" },
          shipping_line_id: { type: ["string", "null"], format: "uuid" },
          shipping_line_code: { type: "string" },
          shipping_line_name: { type: "string" },
          item_count: { type: "integer" },
          chargeable_weight_grams: { type: ["integer", "null"] },
          currency: { type: "string" },
          tracking_number: { type: "string" },
          final_fee_cents: { type: ["integer", "null"] },
          final_fee: { type: ["number", "null"] },
          payment_status: { type: "string" },
          payment_amount_cents: { type: ["integer", "null"] },
          payment_amount: { type: ["number", "null"] },
          payment_provider: { type: "string" },
          submitted_at: { type: ["string", "null"], format: "date-time" },
          paid_at: { type: ["string", "null"], format: "date-time" },
          shipped_at: { type: ["string", "null"], format: "date-time" },
          delivered_at: { type: ["string", "null"], format: "date-time" },
          created_at: { type: ["string", "null"], format: "date-time" },
          updated_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "user_id", "status", "currency"]),
        AdminPoliciesResponse: objectSchema({
          policies: { type: "array", items: { $ref: "#/components/schemas/AdminPolicyPage" } },
          pagination: { $ref: "#/components/schemas/AdminPagination" }
        }, ["policies", "pagination"]),
        AdminPolicyEnvelope: objectSchema({
          policy: { $ref: "#/components/schemas/AdminPolicyPage" }
        }, ["policy"]),
        AdminPolicyPatchRequest: objectSchema({
          title: { type: "string", maxLength: 160 },
          body: { type: "string", maxLength: 5000 },
          status: { type: "string", enum: ["draft", "published", "archived"] }
        }),
        AdminPolicyPage: objectSchema({
          id: { type: "string", format: "uuid" },
          policy_type: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          status: { type: "string" },
          version: { type: "integer" },
          published_at: { type: ["string", "null"], format: "date-time" },
          created_at: { type: ["string", "null"], format: "date-time" },
          updated_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "policy_type", "title", "body", "status", "version"]),
        User: objectSchema({
          id: { type: "string", format: "uuid" },
          email: { type: "string", format: "email" },
          display_name: { type: "string" },
          status: { type: "string" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "email", "display_name", "status"]),
        AdminUser: objectSchema({
          id: { type: "string", format: "uuid" },
          email: { type: "string", format: "email" },
          display_name: { type: "string" },
          status: { type: "string" },
          last_login_at: { type: ["string", "null"], format: "date-time" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "email", "display_name", "status"]),
        SessionTokens: objectSchema({
          access_token: { type: "string" },
          refresh_token: { type: "string" },
          expires_at: { type: "string", format: "date-time" },
          refresh_expires_at: { type: "string", format: "date-time" },
          absolute_expires_at: { type: "string", format: "date-time" },
          token_type: { const: "Bearer" }
        }, ["access_token", "refresh_token", "expires_at", "refresh_expires_at", "token_type"]),
        SaveLinkRequest: objectSchema({
          url: { type: "string", maxLength: 2048 }
        }, ["url"]),
        CatalogParseSubmitRequest: objectSchema({
          url: { type: "string", maxLength: 2048 },
          saved_link_id: { type: "string", format: "uuid" }
        }, ["url"]),
        CatalogManualFillRequest: objectSchema({
          title: { type: "string", maxLength: 240 },
          price: { type: "number", exclusiveMinimum: 0 },
          domestic_shipping: { type: ["number", "null"], minimum: 0 },
          currency: { type: "string", maxLength: 3 },
          shop: { type: "string", maxLength: 240 },
          main_image: { type: "string", maxLength: 1024 },
          spec: { type: "string", maxLength: 240 },
          images: { type: "array", items: { type: "string" } },
          sizes: { type: "array", items: { type: "string" } },
          colors: { type: "array", items: { type: "string" } }
        }, ["title", "price"]),
        CatalogPriceCalculationRequest: objectSchema({
          snapshot_id: { type: "string", format: "uuid" },
          quantity: { type: "integer", minimum: 1 },
          spec: { type: "string", maxLength: 240 },
          expected_unit_price_cents: { type: ["integer", "null"], minimum: 0 }
        }, ["snapshot_id", "quantity"]),
        CatalogParseJob: objectSchema({
          id: { type: "string", format: "uuid" },
          platform: { type: "string", enum: ["Taobao", "1688", "Weidian", "Yupoo", "Other"] },
          url: { type: "string" },
          status: { type: "string", enum: ["queued", "retrying", "snapshotted", "manual", "dead_letter"] },
          attempt: { type: "integer" },
          reason: { type: "string" },
          snapshot_id: { type: ["string", "null"], format: "uuid" },
          created_at: { type: ["string", "null"], format: "date-time" },
          updated_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "platform", "status"]),
        CatalogSnapshot: objectSchema({
          id: { type: "string", format: "uuid" },
          platform: { type: "string" },
          source_url: { type: "string" },
          shop: { type: "string" },
          title: { type: "string" },
          main_image: { type: "string" },
          images: { type: "array", items: { type: "string" } },
          price_cents: { type: "integer" },
          currency: { type: "string" },
          domestic_shipping_cents: { type: ["integer", "null"] },
          spec: { type: "string" },
          sizes: { type: "array", items: { type: "string" } },
          colors: { type: "array", items: { type: "string" } },
          skus: { type: "array", items: { type: "object", additionalProperties: true } },
          price_tiers: { type: "array", items: { type: "object", additionalProperties: true } },
          min_order_quantity: { type: ["integer", "null"] },
          source: { type: "string", enum: ["scraped", "manual"] },
          source_captured_at: { type: ["string", "null"], format: "date-time" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "platform", "title", "price_cents", "source"]),
        CatalogPriceCalculation: objectSchema({
          id: { type: "string", format: "uuid" },
          snapshot_id: { type: "string", format: "uuid" },
          spec: { type: "string" },
          quantity: { type: "integer" },
          unit_price_cents: { type: "integer" },
          items_cents: { type: "integer" },
          domestic_shipping_cents: { type: ["integer", "null"] },
          total_cents: { type: ["integer", "null"] },
          complete: { type: "boolean" },
          purchasable: { type: "boolean" },
          reason: { type: "string" },
          currency: { type: "string" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "snapshot_id", "quantity", "unit_price_cents", "items_cents", "complete", "purchasable"]),
        CatalogParseJobEnvelope: objectSchema({
          job: { $ref: "#/components/schemas/CatalogParseJob" },
          existing: { type: "boolean" }
        }, ["job"]),
        CatalogParseJobListEnvelope: objectSchema({
          jobs: { type: "array", items: { $ref: "#/components/schemas/CatalogParseJob" } }
        }, ["jobs"]),
        CatalogParseJobDetailEnvelope: objectSchema({
          job: { $ref: "#/components/schemas/CatalogParseJob" },
          snapshot: { oneOf: [{ $ref: "#/components/schemas/CatalogSnapshot" }, { type: "null" }] }
        }, ["job"]),
        CatalogSnapshotEnvelope: objectSchema({
          snapshot: { $ref: "#/components/schemas/CatalogSnapshot" }
        }, ["snapshot"]),
        CatalogPriceCalculationEnvelope: objectSchema({
          calculation: { $ref: "#/components/schemas/CatalogPriceCalculation" }
        }, ["calculation"]),
        OrderCreateRequest: objectSchema({
          submit_key: { type: "string", maxLength: 120 },
          items: {
            type: "array",
            minItems: 1,
            items: objectSchema({
              snapshot_id: { type: "string", format: "uuid" },
              quantity: { type: "integer", minimum: 1 },
              spec: { type: "string", maxLength: 240 },
              expected_unit_price_cents: { type: ["integer", "null"], minimum: 0 }
            }, ["snapshot_id", "quantity"])
          }
        }, ["submit_key", "items"]),
        OrderItem: objectSchema({
          id: { type: "string", format: "uuid" },
          item_no: { type: "string" },
          snapshot_id: { type: "string", format: "uuid" },
          spec: { type: "string" },
          quantity: { type: "integer" },
          unit_price_cents: { type: "integer" },
          items_cents: { type: "integer" },
          domestic_shipping_cents: { type: "integer" },
          total_cents: { type: "integer" },
          currency: { type: "string" },
          platform: { type: "string" },
          fulfillment_status: { type: "string" },
          exception_status: { type: "string" },
          purchase_account_id: { type: ["string", "null"], format: "uuid" },
          assigned_at: { type: ["string", "null"], format: "date-time" },
          claimed_by_admin_id: { type: ["string", "null"], format: "uuid" },
          claimed_at: { type: ["string", "null"], format: "date-time" },
          created_at: { type: ["string", "null"], format: "date-time" },
          updated_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "item_no", "snapshot_id", "quantity", "total_cents", "fulfillment_status", "exception_status"]),
        Order: objectSchema({
          id: { type: "string", format: "uuid" },
          order_no: { type: "string" },
          item_count: { type: "integer" },
          items_total_cents: { type: "integer" },
          currency: { type: "string" },
          payment_status: { type: "string", enum: ["unpaid", "paid", "cancelled"] },
          paid_at: { type: ["string", "null"], format: "date-time" },
          created_at: { type: ["string", "null"], format: "date-time" },
          updated_at: { type: ["string", "null"], format: "date-time" },
          items: { type: "array", items: { $ref: "#/components/schemas/OrderItem" } }
        }, ["id", "order_no", "item_count", "items_total_cents", "payment_status", "items"]),
        OrderEnvelope: objectSchema({
          order: { $ref: "#/components/schemas/Order" },
          existing: { type: "boolean" }
        }, ["order"]),
        OrderListEnvelope: objectSchema({
          orders: { type: "array", items: { $ref: "#/components/schemas/Order" } }
        }, ["orders"]),
        PurchaseAccount: objectSchema({
          id: { type: "string", format: "uuid" },
          platform: { type: "string" },
          label: { type: "string" },
          account_ref: { type: "string" },
          role: { type: "string", enum: ["default", "backup"] },
          owner_admin_id: { type: ["string", "null"], format: "uuid" },
          enabled: { type: "boolean" },
          version: { type: "integer" },
          created_at: { type: ["string", "null"], format: "date-time" },
          updated_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "platform", "label", "role", "enabled", "version"]),
        CreatePurchaseAccountRequest: objectSchema({
          platform: { type: "string", maxLength: 40 },
          label: { type: "string", maxLength: 120 },
          account_ref: { type: "string", maxLength: 240 },
          role: { type: "string", enum: ["default", "backup"] },
          owner_admin_id: { type: ["string", "null"], format: "uuid" },
          enabled: { type: "boolean" }
        }, ["platform", "label"]),
        UpdatePurchaseAccountRequest: objectSchema({
          version: { type: "integer", minimum: 1 },
          label: { type: "string", maxLength: 120 },
          role: { type: "string", enum: ["default", "backup"] },
          owner_admin_id: { type: ["string", "null"], format: "uuid" },
          enabled: { type: "boolean" }
        }, ["version"]),
        PurchaseAccountEnvelope: objectSchema({
          account: { $ref: "#/components/schemas/PurchaseAccount" }
        }, ["account"]),
        PurchaseAccountListEnvelope: objectSchema({
          accounts: { type: "array", items: { $ref: "#/components/schemas/PurchaseAccount" } }
        }, ["accounts"]),
        ProcurementTaskListEnvelope: objectSchema({
          tasks: { type: "array", items: { $ref: "#/components/schemas/OrderItem" } }
        }, ["tasks"]),
        ProcurementTaskEnvelope: objectSchema({
          task: { $ref: "#/components/schemas/OrderItem" }
        }, ["task"]),
        ProcurementTaskDetailEnvelope: objectSchema({
          task: { $ref: "#/components/schemas/OrderItem" },
          timeline: { type: "array", items: { $ref: "#/components/schemas/OrderStatusHistory" } },
          exception: { oneOf: [{ $ref: "#/components/schemas/OrderException" }, { type: "null" }] },
          confirmation: { oneOf: [{ $ref: "#/components/schemas/PurchaseConfirmation" }, { type: "null" }] }
        }, ["task", "timeline"]),
        OrderStatusHistory: objectSchema({
          id: { type: "string", format: "uuid" },
          field: { type: "string" },
          from_status: { type: "string" },
          to_status: { type: "string" },
          action: { type: "string" },
          reason: { type: "string" },
          actor_type: { type: "string" },
          actor_role: { type: "string" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "field", "from_status", "to_status", "action"]),
        ConfirmPurchaseRequest: objectSchema({
          actual_platform: { type: "string", maxLength: 40 },
          actual_account: { type: "string", maxLength: 240 },
          actual_order_no: { type: "string", maxLength: 120 },
          spec: { type: "string", maxLength: 240 },
          quantity: { type: "integer", minimum: 1 },
          cost: { type: "number", exclusiveMinimum: 0 },
          shipping: { type: "number", minimum: 0 },
          voucher_keys: { type: "array", items: { type: "string" } }
        }, ["actual_platform", "actual_order_no", "quantity", "cost"]),
        PurchaseConfirmation: objectSchema({
          id: { type: "string", format: "uuid" },
          item_order_id: { type: "string", format: "uuid" },
          actual_platform: { type: "string" },
          actual_account: { type: "string" },
          actual_order_no: { type: "string" },
          spec: { type: "string" },
          quantity: { type: "integer" },
          cost_cents: { type: "integer" },
          shipping_cents: { type: "integer" },
          voucher_keys: { type: "array", items: { type: "string" } },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "item_order_id", "actual_order_no", "quantity", "cost_cents"]),
        PurchaseConfirmationEnvelope: objectSchema({
          task: { $ref: "#/components/schemas/OrderItem" },
          confirmation: { $ref: "#/components/schemas/PurchaseConfirmation" }
        }, ["task", "confirmation"]),
        OrderException: objectSchema({
          id: { type: "string", format: "uuid" },
          item_order_id: { type: "string", format: "uuid" },
          type: { type: "string", enum: ["price_increase", "availability", "purchase_failed"] },
          status: { type: "string", enum: ["open", "resolved", "cancelled", "expired"] },
          surcharge_cents: { type: ["integer", "null"] },
          currency: { type: "string" },
          detail: { type: "object", additionalProperties: true },
          resolution: { type: "string" },
          deadline_at: { type: ["string", "null"], format: "date-time" },
          resolved_at: { type: ["string", "null"], format: "date-time" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "item_order_id", "type", "status"]),
        OrderExceptionEvent: objectSchema({
          id: { type: "string", format: "uuid" },
          action: { type: "string" },
          detail: { type: "object", additionalProperties: true },
          actor_type: { type: "string" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "action"]),
        RaisePriceIncreaseRequest: objectSchema({
          new_unit_price_cents: { type: "integer", minimum: 1 },
          deadline_hours: { type: "integer", minimum: 1, maximum: 168 }
        }, ["new_unit_price_cents"]),
        RaiseAvailabilityRequest: objectSchema({
          reason: { type: "string", maxLength: 500 },
          deadline_hours: { type: "integer", minimum: 1, maximum: 168 }
        }),
        ExceptionRespondRequest: objectSchema({
          choice: { type: "string", enum: ["pay_surcharge", "wait", "change_spec", "change_link", "cancel"] },
          spec: { type: "string", maxLength: 240 },
          link: { type: "string", maxLength: 1024 }
        }, ["choice"]),
        OrderExceptionEnvelope: objectSchema({
          exception: { $ref: "#/components/schemas/OrderException" },
          item: { $ref: "#/components/schemas/OrderItem" }
        }, ["exception", "item"]),
        OrderExceptionDetailEnvelope: objectSchema({
          exception: { oneOf: [{ $ref: "#/components/schemas/OrderException" }, { type: "null" }] },
          events: { type: "array", items: { $ref: "#/components/schemas/OrderExceptionEvent" } }
        }, ["events"]),
        OrderItemEnvelope: objectSchema({
          item: { $ref: "#/components/schemas/OrderItem" }
        }, ["item"]),
        RegisterDispatchRequest: objectSchema({
          carrier: { type: "string", maxLength: 120 },
          tracking_no: { type: "string", maxLength: 120 }
        }),
        ReassignRequest: objectSchema({
          account_id: { type: ["string", "null"], format: "uuid" },
          buyer_admin_id: { type: ["string", "null"], format: "uuid" }
        }),
        ControlledCorrectionRequest: objectSchema({
          to: { type: "string", maxLength: 40 },
          reason: { type: "string", maxLength: 500 }
        }, ["to"]),
        WalletV2: objectSchema({
          available_cny_minor: { type: "integer" },
          frozen_cny_minor: { type: "integer" },
          version: { type: "integer" }
        }, ["available_cny_minor", "frozen_cny_minor"]),
        WalletV2Envelope: objectSchema({
          wallet: { $ref: "#/components/schemas/WalletV2" }
        }, ["wallet"]),
        WalletTransaction: objectSchema({
          id: { type: "string", format: "uuid" },
          tx_no: { type: "string" },
          type: { type: "string" },
          status: { type: "string", enum: ["pending", "posted", "failed"] },
          business_type: { type: "string" },
          business_ref: { type: ["string", "null"], format: "uuid" },
          amount_cny_minor: { type: "integer" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "tx_no", "type", "status", "amount_cny_minor"]),
        WalletTransactionListEnvelope: objectSchema({
          transactions: { type: "array", items: { $ref: "#/components/schemas/WalletTransaction" } }
        }, ["transactions"]),
        ScanInboundRequest: objectSchema({
          tracking_no: { type: "string", maxLength: 120 },
          carrier: { type: "string", maxLength: 120 }
        }, ["tracking_no"]),
        LinkInboundRequest: objectSchema({
          item_order_id: { type: "string", format: "uuid" },
          evidence: { type: "array", items: { type: "string" } }
        }, ["item_order_id", "evidence"]),
        MeasureInboundRequest: objectSchema({
          weight_grams: { type: "integer", minimum: 1 },
          length_mm: { type: "integer", minimum: 1 },
          width_mm: { type: "integer", minimum: 1 },
          height_mm: { type: "integer", minimum: 1 },
          photo_keys: { type: "array", items: { type: "string" } },
          version: { type: "integer", minimum: 0 }
        }, ["weight_grams", "length_mm", "width_mm", "height_mm", "photo_keys", "version"]),
        Inbound: objectSchema({
          id: { type: "string", format: "uuid" },
          domestic_tracking_no: { type: "string" },
          carrier: { type: "string" },
          item_order_id: { type: ["string", "null"], format: "uuid" },
          status: { type: "string", enum: ["unclaimed", "matched", "measured"] },
          first_scanned_at: { type: ["string", "null"], format: "date-time" },
          weight_grams: { type: ["integer", "null"] },
          length_mm: { type: ["integer", "null"] },
          width_mm: { type: ["integer", "null"] },
          height_mm: { type: ["integer", "null"] },
          photo_keys: { type: "array", items: { type: "string" } },
          measurement_version: { type: "integer" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "domestic_tracking_no", "status"]),
        InboundEnvelope: objectSchema({
          inbound: { $ref: "#/components/schemas/Inbound" },
          existing: { type: "boolean" },
          matched: { type: "boolean" }
        }, ["inbound"]),
        InboundListEnvelope: objectSchema({
          inbound_packages: { type: "array", items: { $ref: "#/components/schemas/Inbound" } }
        }, ["inbound_packages"]),
        QcPhotoRequest: objectSchema({
          slot: { type: "string", enum: ["front", "back", "side", "label"] },
          storage_key: { type: "string", maxLength: 512 }
        }, ["slot", "storage_key"]),
        QcTask: objectSchema({
          id: { type: "string", format: "uuid" },
          item_order_id: { type: "string", format: "uuid" },
          type: { type: "string", enum: ["standard", "extra_photo", "detailed"] },
          status: { type: "string", enum: ["pending", "claimed", "in_progress", "exception", "completed", "cancelled"] },
          assignee_admin_id: { type: ["string", "null"], format: "uuid" },
          unpack_required: { type: "boolean" },
          wait_hours: { type: "integer" },
          exception_note: { type: "string" },
          completed_at: { type: ["string", "null"], format: "date-time" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "item_order_id", "type", "status"]),
        QcPhoto: objectSchema({
          id: { type: "string", format: "uuid" },
          slot: { type: "string" },
          storage_key: { type: "string" },
          version: { type: "integer" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "slot", "version"]),
        QcTaskEnvelope: objectSchema({ qc_task: { $ref: "#/components/schemas/QcTask" } }, ["qc_task"]),
        QcTaskListEnvelope: objectSchema({ qc_tasks: { type: "array", items: { $ref: "#/components/schemas/QcTask" } } }, ["qc_tasks"]),
        QcTaskDetailEnvelope: objectSchema({
          qc_task: { $ref: "#/components/schemas/QcTask" },
          photos: { type: "array", items: { $ref: "#/components/schemas/QcPhoto" } },
          present_slots: { type: "array", items: { type: "string" } }
        }, ["qc_task"]),
        QcPhotoEnvelope: objectSchema({
          photo: { $ref: "#/components/schemas/QcPhoto" },
          present_slots: { type: "array", items: { type: "string" } },
          complete_ready: { type: "boolean" }
        }, ["photo"]),
        QcExceptionRequest: objectSchema({
          type: { type: "string", maxLength: 60 },
          note: { type: "string", maxLength: 1000 },
          photo_keys: { type: "array", items: { type: "string" } }
        }, ["type"]),
        QcExtraRequest: objectSchema({
          quantity: { type: "integer", minimum: 1, maximum: 20 },
          idempotency_key: { type: "string", maxLength: 120 }
        }, ["quantity", "idempotency_key"]),
        QcDetailedRequest: objectSchema({
          items: { type: "array", items: objectSchema({ name: { type: "string" }, electronics: { type: "boolean" } }, []) },
          idempotency_key: { type: "string", maxLength: 120 }
        }, ["items", "idempotency_key"]),
        QcPurchase: objectSchema({
          id: { type: "string", format: "uuid" },
          item_order_id: { type: "string", format: "uuid" },
          kind: { type: "string", enum: ["extra_photo", "detailed"] },
          quantity: { type: "integer" },
          amount_cny_minor: { type: "integer" },
          status: { type: "string", enum: ["paid", "refunded"] },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "kind", "quantity", "amount_cny_minor", "status"]),
        QcPurchaseEnvelope: objectSchema({
          purchase: { $ref: "#/components/schemas/QcPurchase" },
          existing: { type: "boolean" }
        }, ["purchase"]),
        Inventory: objectSchema({
          id: { type: "string", format: "uuid" },
          stock_no: { type: "string" },
          item_order_id: { type: "string", format: "uuid" },
          status: { type: "string" },
          official_inbound_at: { type: ["string", "null"], format: "date-time" },
          return_deadline_at: { type: ["string", "null"], format: "date-time" },
          location_id: { type: ["string", "null"], format: "uuid" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "stock_no", "status"]),
        QcCompleteEnvelope: objectSchema({
          qc_task: { $ref: "#/components/schemas/QcTask" },
          inventory: { $ref: "#/components/schemas/Inventory" },
          replay: { type: "boolean" }
        }, ["qc_task", "inventory"]),
        InventoryListEnvelope: objectSchema({
          inventory: { type: "array", items: { $ref: "#/components/schemas/Inventory" } }
        }, ["inventory"]),
        InventoryEnvelope: objectSchema({
          inventory: { $ref: "#/components/schemas/Inventory" },
          replay: { type: "boolean" }
        }, ["inventory"]),
        CreateLocationRequest: objectSchema({
          code: { type: "string", maxLength: 60 },
          area: { type: "string" }, shelf: { type: "string" }, level: { type: "string" }, position: { type: "string" }
        }, ["code"]),
        Location: objectSchema({
          id: { type: "string", format: "uuid" },
          code: { type: "string" }, area: { type: "string" }, shelf: { type: "string" },
          level: { type: "string" }, position: { type: "string" }, enabled: { type: "boolean" }
        }, ["id", "code", "enabled"]),
        LocationEnvelope: objectSchema({ location: { $ref: "#/components/schemas/Location" } }, ["location"]),
        LocationListEnvelope: objectSchema({ locations: { type: "array", items: { $ref: "#/components/schemas/Location" } } }, ["locations"]),
        AssignLocationRequest: objectSchema({
          stock_no: { type: "string" }, location_code: { type: "string" }
        }, ["stock_no", "location_code"]),
        MoveLocationRequest: objectSchema({
          stock_no: { type: "string" }, from_location_code: { type: "string" }, to_location_code: { type: "string" }, reason: { type: "string" }
        }, ["stock_no", "from_location_code", "to_location_code"]),
        ShippingRestrictionsRequest: objectSchema({
          stock_no: { type: "string" }, restrictions: { type: "array", items: { type: "string" } }
        }, ["stock_no", "restrictions"]),
        ExtendStorageRequest: objectSchema({
          months: { type: "integer", minimum: 1, maximum: 2 },
          idempotency_key: { type: "string", maxLength: 120 }
        }, ["months", "idempotency_key"]),
        DestroyRequest: objectSchema({
          quantity: { type: "integer", minimum: 1 },
          photo_keys: { type: "array", items: { type: "string" } }
        }, ["quantity", "photo_keys"]),
        StorageStatus: objectSchema({
          free_until: { type: ["string", "null"], format: "date-time" },
          deadline: { type: ["string", "null"], format: "date-time" },
          destroy_eligible_at: { type: ["string", "null"], format: "date-time" },
          days_left: { type: "integer" },
          expired: { type: "boolean" },
          destroy_eligible: { type: "boolean" }
        }, ["days_left", "expired"]),
        StorageEnvelope: objectSchema({
          inventory: { $ref: "#/components/schemas/Inventory" },
          storage: { type: "object", additionalProperties: true },
          existing: { type: "boolean" }
        }, ["inventory", "storage"]),
        SetPriceVersionRequest: objectSchema({
          first_weight_grams: { type: "integer", minimum: 1 },
          first_price_minor: { type: "integer", minimum: 0 },
          continued_step_grams: { type: "integer", minimum: 1 },
          continued_price_minor: { type: "integer", minimum: 0 },
          volumetric_divisor: { type: "integer", minimum: 1 },
          rounding_grams: { type: "integer", minimum: 1 },
          fuel_surcharge_bps: { type: "integer", minimum: 0 },
          remote_surcharge_minor: { type: "integer", minimum: 0 },
          operation_fee_minor: { type: "integer", minimum: 0 },
          insurance_bps: { type: "integer", minimum: 0 },
          eta_days: { type: "integer", minimum: 0 },
          max_weight_grams: { type: ["integer", "null"], minimum: 1 }
        }, ["first_weight_grams", "first_price_minor"]),
        PriceVersion: objectSchema({
          id: { type: "string", format: "uuid" }, route_id: { type: "string", format: "uuid" },
          version: { type: "integer" }, first_weight_grams: { type: "integer" }, first_price_minor: { type: "integer" },
          active: { type: "boolean" }
        }, ["id", "version"]),
        PriceVersionEnvelope: objectSchema({ price_version: { $ref: "#/components/schemas/PriceVersion" } }, ["price_version"]),
        FreightQuoteRequest: objectSchema({
          route_code: { type: "string" },
          actual_weight_grams: { type: "integer", minimum: 0 },
          dimensions_cm: { type: "object", additionalProperties: true },
          insured_value_minor: { type: "integer", minimum: 0 },
          remote: { type: "boolean" }
        }, ["route_code"]),
        FreightQuoteEnvelope: objectSchema({
          route: { type: "object", additionalProperties: true },
          price_version_id: { type: "string", format: "uuid" },
          quote: { type: "object", additionalProperties: true }
        }, ["quote"]),
        CreateParcelRequest: objectSchema({
          address_id: { type: "string" },
          destination_country: { type: "string", minLength: 2, maxLength: 2 },
          stock_nos: { type: "array", items: { type: "string" }, minItems: 1 },
          value_added_service_codes: { type: "array", items: { type: "string" } }
        }, ["stock_nos"]),
        CreateTopUpRequest: objectSchema({
          amount: { type: "number", exclusiveMinimum: 0 },
          currency: { type: "string", maxLength: 3 },
          channel: { type: "string", maxLength: 40 },
          idempotency_key: { type: "string", maxLength: 120 }
        }, ["amount"]),
        TopUp: objectSchema({
          id: { type: "string", format: "uuid" },
          top_up_no: { type: "string" },
          provider: { type: "string" },
          channel: { type: "string" },
          original_currency: { type: "string" },
          original_amount_minor: { type: "integer" },
          fee_cny_minor: { type: "integer" },
          cny_credited_minor: { type: "integer" },
          system_status: { type: "string", enum: ["created", "pending_provider", "succeeded", "failed", "expired", "exception"] },
          channel_status: { type: "string" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "top_up_no", "system_status", "cny_credited_minor"]),
        TopUpEnvelope: objectSchema({
          top_up: { $ref: "#/components/schemas/TopUp" },
          redirect_url: { type: "string" },
          existing: { type: "boolean" }
        }, ["top_up"]),
        TopUpListEnvelope: objectSchema({
          top_ups: { type: "array", items: { $ref: "#/components/schemas/TopUp" } }
        }, ["top_ups"]),
        PaymentWebhookEnvelope: objectSchema({
          top_up: { $ref: "#/components/schemas/TopUp" },
          settled: { type: "boolean" }
        }, ["top_up", "settled"]),
        SetExchangeRateRequest: objectSchema({
          currency: { type: "string", maxLength: 3 },
          cny_per_unit: { type: "number", exclusiveMinimum: 0 }
        }, ["currency", "cny_per_unit"]),
        ExchangeRate: objectSchema({
          id: { type: "string", format: "uuid" },
          currency: { type: "string" },
          cny_per_unit_micro: { type: "integer" },
          version: { type: "integer" },
          active: { type: "boolean" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["currency", "cny_per_unit_micro", "version", "active"]),
        ExchangeRateEnvelope: objectSchema({
          rate: { $ref: "#/components/schemas/ExchangeRate" }
        }, ["rate"]),
        ExchangeRateListEnvelope: objectSchema({
          rates: { type: "array", items: { $ref: "#/components/schemas/ExchangeRate" } }
        }, ["rates"]),
        OrderPaymentEnvelope: objectSchema({
          order: { $ref: "#/components/schemas/Order" },
          wallet: { $ref: "#/components/schemas/WalletV2" }
        }, ["order", "wallet"]),
        OrderPaymentPreview: objectSchema({
          payable: { type: "boolean" },
          total_cny_minor: { type: "integer" },
          available_cny_minor: { type: "integer" },
          shortfall_cny_minor: { type: "integer" }
        }, ["payable", "total_cny_minor", "available_cny_minor", "shortfall_cny_minor"]),
        SurchargePaymentEnvelope: objectSchema({
          item: { $ref: "#/components/schemas/OrderItem" },
          wallet: { $ref: "#/components/schemas/WalletV2" }
        }, ["item", "wallet"]),
        RequestWithdrawalRequest: objectSchema({
          amount: { type: "number", exclusiveMinimum: 0 },
          payee_ref: { type: "string", maxLength: 240 }
        }, ["amount"]),
        ReviewWithdrawalRequest: objectSchema({
          decision: { type: "string", enum: ["approve", "reject"] },
          reason: { type: "string", maxLength: 500 }
        }, ["decision"]),
        Withdrawal: objectSchema({
          id: { type: "string", format: "uuid" },
          withdrawal_no: { type: "string" },
          amount_cny_minor: { type: "integer" },
          source: { type: "string" },
          status: { type: "string", enum: ["pending_review", "processing", "succeeded", "rejected", "failed"] },
          reason: { type: "string" },
          failure_reason: { type: "string" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "withdrawal_no", "amount_cny_minor", "status"]),
        WithdrawalEnvelope: objectSchema({
          withdrawal: { $ref: "#/components/schemas/Withdrawal" }
        }, ["withdrawal"]),
        WithdrawalListEnvelope: objectSchema({
          withdrawals: { type: "array", items: { $ref: "#/components/schemas/Withdrawal" } }
        }, ["withdrawals"]),
        CreateAdjustmentRequest: objectSchema({
          user_id: { type: "string", format: "uuid" },
          direction: { type: "string", enum: ["credit", "debit"] },
          amount: { type: "number", exclusiveMinimum: 0 },
          reason: { type: "string", maxLength: 500 },
          evidence: { type: "array", items: { type: "string" } },
          business_ref: { type: "string", maxLength: 120 }
        }, ["user_id", "direction", "amount", "reason"]),
        Adjustment: objectSchema({
          id: { type: "string", format: "uuid" },
          adjustment_no: { type: "string" },
          user_id: { type: "string", format: "uuid" },
          direction: { type: "string", enum: ["credit", "debit"] },
          amount_cny_minor: { type: "integer" },
          reason: { type: "string" },
          business_ref: { type: "string" },
          status: { type: "string", enum: ["pending_review", "approved", "executed", "rejected", "execution_failed"] },
          failure_reason: { type: "string" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "adjustment_no", "direction", "amount_cny_minor", "status"]),
        AdjustmentEnvelope: objectSchema({
          adjustment: { $ref: "#/components/schemas/Adjustment" }
        }, ["adjustment"]),
        AdjustmentListEnvelope: objectSchema({
          adjustments: { type: "array", items: { $ref: "#/components/schemas/Adjustment" } }
        }, ["adjustments"]),
        ReconciliationImportRequest: objectSchema({
          file_hash: { type: "string", maxLength: 128 },
          records: {
            type: "array",
            items: objectSchema({
              provider_txn_id: { type: "string" },
              amount_minor: { type: "integer" },
              currency: { type: "string", maxLength: 3 },
              status: { type: "string" }
            }, ["provider_txn_id", "amount_minor"])
          }
        }, ["file_hash"]),
        ReconciliationDiff: objectSchema({
          id: { type: "string", format: "uuid" },
          provider_txn_id: { type: "string" },
          diff_type: { type: "string", enum: ["missing_local", "amount_mismatch", "status_mismatch"] },
          provider_amount_minor: { type: ["integer", "null"] },
          local_amount_minor: { type: ["integer", "null"] },
          provider_currency: { type: "string" },
          cny_minor: { type: ["integer", "null"] },
          usd_minor: { type: ["integer", "null"] }
        }, ["id", "provider_txn_id", "diff_type"]),
        ReconciliationBatch: objectSchema({
          id: { type: "string", format: "uuid" },
          file_hash: { type: "string" },
          provider: { type: "string" },
          record_count: { type: "integer" },
          diff_count: { type: "integer" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "file_hash", "record_count", "diff_count"]),
        ReconciliationEnvelope: objectSchema({
          batch: { $ref: "#/components/schemas/ReconciliationBatch" },
          diffs: { type: "array", items: { $ref: "#/components/schemas/ReconciliationDiff" } },
          existing: { type: "boolean" }
        }, ["batch", "diffs"]),
        UpdateLinkRequest: objectSchema({
          title: { type: "string", maxLength: 240 },
          spec: { type: "string", maxLength: 240 },
          price: { type: "number", exclusiveMinimum: 0 },
          currency: { type: "string", maxLength: 3 },
          quantity: { type: "integer", minimum: 1 },
          note: { type: "string", maxLength: 1000 }
        }),
        SavedLinkEnvelope: objectSchema({
          link: { $ref: "#/components/schemas/SavedLink" },
          existing: { type: "boolean" }
        }, ["link"]),
        SavedLinksResponse: objectSchema({
          links: { type: "array", items: { $ref: "#/components/schemas/SavedLink" } }
        }, ["links"]),
        ParseLinkResponse: objectSchema({
          link: { $ref: "#/components/schemas/SavedLink" },
          job: { type: ["object", "null"], additionalProperties: true },
          error: { type: "string" }
        }, ["link"]),
        SavedLink: objectSchema({
          id: { type: "string", format: "uuid" },
          url: { type: "string" },
          domain: { type: "string" },
          platform: { type: "string", enum: ["Taobao", "1688", "Weidian", "Yupoo", "Other"] },
          status: { type: "string" },
          title: { type: "string" },
          spec: { type: "string" },
          price: { type: ["number", "null"] },
          currency: { type: "string" },
          quantity: { type: "integer" },
          note: { type: "string" },
          parse_error: { type: "string" },
          created_at: { type: ["string", "null"], format: "date-time" },
          updated_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "url", "domain", "platform", "status", "created_at"]),
        HaulItemEnvelope: objectSchema({
          item: { $ref: "#/components/schemas/HaulItem" },
          existing: { type: "boolean" }
        }, ["item"]),
        HaulItemsResponse: objectSchema({
          items: { type: "array", items: { $ref: "#/components/schemas/HaulItem" } }
        }, ["items"]),
        HaulItem: objectSchema({
          id: { type: "string", format: "uuid" },
          saved_link_id: { type: "string", format: "uuid" },
          title: { type: "string" },
          spec: { type: "string" },
          price: { type: "number" },
          currency: { type: "string" },
          quantity: { type: "integer" },
          note: { type: "string" },
          source_platform: { type: "string" },
          source_domain: { type: "string" },
          status: { type: "string" },
          created_at: { type: ["string", "null"], format: "date-time" },
          updated_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "saved_link_id", "title", "spec", "price", "quantity", "status"]),
        PurchaseOrderRequest: objectSchema({
          haul_item_id: { type: "string", format: "uuid" }
        }, ["haul_item_id"]),
        PurchaseOrderEnvelope: objectSchema({
          order: { $ref: "#/components/schemas/PurchaseOrder" },
          existing: { type: "boolean" }
        }, ["order"]),
        OrdersResponse: objectSchema({
          orders: { type: "array", items: { $ref: "#/components/schemas/PurchaseOrder" } }
        }, ["orders"]),
        PurchaseOrder: objectSchema({
          id: { type: "string", format: "uuid" },
          haul_item_id: { type: "string", format: "uuid" },
          status: { type: "string" },
          exception: { type: "string" },
          external_order_no: { type: "string" },
          created_at: { type: ["string", "null"], format: "date-time" },
          updated_at: { type: ["string", "null"], format: "date-time" },
          history: { type: "array", items: { $ref: "#/components/schemas/OrderStatusHistory" } }
        }, ["id", "haul_item_id", "status", "history"]),
        OrderStatusHistory: objectSchema({
          from_status: { type: ["string", "null"] },
          to_status: { type: "string" },
          changed_by_type: { type: "string" },
          reason: { type: "string" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["to_status", "changed_by_type", "created_at"]),
        WarehouseReceiveRequest: objectSchema({
          storage_location: { type: "string", maxLength: 120 },
          received_at: { type: "string", format: "date-time" }
        }),
        WarehouseWeightRequest: objectSchema({
          weight_grams: { type: "integer", minimum: 1, maximum: 200000 },
          weight_kg: { type: "number", exclusiveMinimum: 0, maximum: 200 }
        }),
        QcPhotoUploadRequest: objectSchema({
          photos: {
            type: "array",
            minItems: 3,
            maxItems: 5,
            items: { $ref: "#/components/schemas/QcPhotoUpload" }
          }
        }, ["photos"]),
        QcPhotoUpload: objectSchema({
          file_name: { type: "string", maxLength: 160 },
          content_type: { type: "string", enum: ["image/jpeg", "image/png", "image/webp"] },
          size_bytes: { type: "integer", minimum: 1, maximum: 10485760 },
          data_base64: { type: "string" }
        }, ["content_type", "size_bytes", "data_base64"]),
        WarehouseItemEnvelope: objectSchema({
          warehouse_item: { $ref: "#/components/schemas/WarehouseItem" },
          existing: { type: "boolean" }
        }, ["warehouse_item"]),
        QcPhotoUploadResponse: objectSchema({
          warehouse_item: { $ref: "#/components/schemas/WarehouseItem" },
          photos: { type: "array", items: { $ref: "#/components/schemas/QcPhoto" } },
          existing: { type: "boolean" }
        }, ["warehouse_item", "photos"]),
        QcItemsResponse: objectSchema({
          items: { type: "array", items: { $ref: "#/components/schemas/QcItem" } }
        }, ["items"]),
        QcItemEnvelope: objectSchema({
          item: { $ref: "#/components/schemas/QcItem" },
          existing: { type: "boolean" }
        }, ["item"]),
        ExtraPhotoRequestInput: objectSchema({
          reason: { type: "string", maxLength: 500 }
        }),
        ExtraPhotoRequestEnvelope: objectSchema({
          request: { $ref: "#/components/schemas/ExtraPhotoRequest" },
          existing: { type: "boolean" }
        }, ["request"]),
        StorageStatusEnvelope: objectSchema({
          storage: { $ref: "#/components/schemas/StorageStatus" }
        }, ["storage"]),
        WarehouseItem: objectSchema({
          id: { type: "string", format: "uuid" },
          user_id: { type: "string", format: "uuid" },
          purchase_order_id: { type: "string", format: "uuid" },
          haul_item_id: { type: "string", format: "uuid" },
          status: { type: "string" },
          storage_location: { type: "string" },
          weight_grams: { type: ["integer", "null"] },
          weight_kg: { type: ["number", "null"] },
          received_at: { type: ["string", "null"], format: "date-time" },
          created_at: { type: ["string", "null"], format: "date-time" },
          updated_at: { type: ["string", "null"], format: "date-time" },
          storage: { $ref: "#/components/schemas/StorageStatus" }
        }, ["id", "user_id", "purchase_order_id", "haul_item_id", "status", "storage"]),
        QcItem: objectSchema({
          warehouse_item: { $ref: "#/components/schemas/WarehouseItem" },
          photos: { type: "array", items: { $ref: "#/components/schemas/QcPhoto" } }
        }, ["warehouse_item", "photos"]),
        QcPhoto: objectSchema({
          id: { type: "string", format: "uuid" },
          file_name: { type: "string" },
          content_type: { type: "string" },
          size_bytes: { type: "integer" },
          sort_order: { type: "integer" },
          signed_url: { type: "string", format: "uri" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "file_name", "content_type", "size_bytes", "sort_order", "signed_url"]),
        StorageStatus: objectSchema({
          received_at: { type: ["string", "null"], format: "date-time" },
          free_storage_days: { type: "integer" },
          free_until: { type: ["string", "null"], format: "date-time" },
          days_left: { type: "integer" },
          expired: { type: "boolean" }
        }, ["received_at", "free_storage_days", "free_until", "days_left", "expired"]),
        ExtraPhotoRequest: objectSchema({
          id: { type: "string", format: "uuid" },
          warehouse_item_id: { type: "string", format: "uuid" },
          status: { type: "string" },
          reason: { type: "string" },
          created_at: { type: ["string", "null"], format: "date-time" },
          fulfilled_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "warehouse_item_id", "status", "created_at"]),
        ShippingLinesResponse: objectSchema({
          lines: { type: "array", items: { $ref: "#/components/schemas/ShippingLine" } }
        }, ["lines"]),
        ShippingLine: objectSchema({
          id: { type: "string", format: "uuid" },
          code: { type: "string" },
          name: { type: "string" },
          destination_country: { type: "string" },
          service_level: { type: "string" },
          status: { type: "string" },
          currency: { type: "string" },
          billing_rules: { type: "object", additionalProperties: true },
          restriction_rules: { type: "object", additionalProperties: true },
          delivery_min_days: { type: ["integer", "null"] },
          delivery_max_days: { type: ["integer", "null"] },
          created_at: { type: ["string", "null"], format: "date-time" },
          updated_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "code", "name", "destination_country", "service_level", "status", "currency"]),
        ParcelDraftRequest: objectSchema({
          warehouse_item_ids: {
            type: "array",
            minItems: 1,
            maxItems: 30,
            items: { type: "string", format: "uuid" }
          }
        }, ["warehouse_item_ids"]),
        ParcelsResponse: objectSchema({
          parcels: { type: "array", items: { $ref: "#/components/schemas/Parcel" } }
        }, ["parcels"]),
        ParcelEnvelope: objectSchema({
          parcel: { $ref: "#/components/schemas/Parcel" },
          existing: { type: "boolean" }
        }, ["parcel"]),
        Parcel: objectSchema({
          id: { type: "string", format: "uuid" },
          status: { type: "string" },
          shipping_line_id: { type: ["string", "null"], format: "uuid" },
          quote_id: { type: ["string", "null"], format: "uuid" },
          destination_country: { type: "string" },
          recipient_name: { type: "string" },
          address: { type: "object", additionalProperties: true },
          chargeable_weight_grams: { type: ["integer", "null"] },
          final_fee_cents: { type: ["integer", "null"] },
          final_fee: { type: ["number", "null"] },
          currency: { type: "string" },
          tracking_number: { type: "string" },
          submitted_at: { type: ["string", "null"], format: "date-time" },
          paid_at: { type: ["string", "null"], format: "date-time" },
          shipped_at: { type: ["string", "null"], format: "date-time" },
          delivered_at: { type: ["string", "null"], format: "date-time" },
          created_at: { type: ["string", "null"], format: "date-time" },
          updated_at: { type: ["string", "null"], format: "date-time" },
          items: { type: "array", items: { $ref: "#/components/schemas/ParcelItem" } }
        }, ["id", "status", "currency", "items"]),
        ParcelItem: objectSchema({
          warehouse_item_id: { type: "string", format: "uuid" },
          haul_item_id: { type: "string", format: "uuid" },
          title: { type: "string" },
          spec: { type: "string" },
          price: { type: "number" },
          currency: { type: "string" },
          quantity: { type: "integer" },
          weight_grams: { type: "integer" },
          weight_kg: { type: "number" },
          source_platform: { type: "string" },
          source_domain: { type: "string" }
        }, ["warehouse_item_id", "haul_item_id", "title", "weight_grams"]),
        ShippingPreviewRequest: objectSchema({
          parcel_id: { type: "string", format: "uuid" },
          warehouse_item_ids: {
            type: "array",
            minItems: 1,
            maxItems: 30,
            items: { type: "string", format: "uuid" }
          },
          country: { type: "string" },
          dimensions_cm: { $ref: "#/components/schemas/DimensionsCm" }
        }, ["country"]),
        DimensionsCm: objectSchema({
          length_cm: { type: "number", exclusiveMinimum: 0 },
          width_cm: { type: "number", exclusiveMinimum: 0 },
          height_cm: { type: "number", exclusiveMinimum: 0 }
        }),
        ShippingPreviewResponse: objectSchema({
          parcel_id: { type: ["string", "null"], format: "uuid" },
          destination_country: { type: "string" },
          quotes: { type: "array", items: { $ref: "#/components/schemas/ShippingQuote" } }
        }, ["destination_country", "quotes"]),
        ShippingQuote: objectSchema({
          available: { type: "boolean" },
          quote_id: { type: "string", format: "uuid" },
          line: { $ref: "#/components/schemas/ShippingLine" },
          amount_cents: { type: "integer" },
          amount: { type: "number" },
          currency: { type: "string" },
          actual_weight_grams: { type: "integer" },
          volumetric_weight_grams: { type: "integer" },
          chargeable_weight_grams: { type: "integer" },
          expires_at: { type: ["string", "null"], format: "date-time" },
          reasons: { type: "array", items: { $ref: "#/components/schemas/QuoteUnavailableReason" } }
        }, ["available", "line", "reasons"]),
        QuoteUnavailableReason: objectSchema({
          code: { type: "string" },
          message: { type: "string" }
        }, ["code", "message"]),
        ParcelSubmitRequest: objectSchema({
          parcel_id: { type: "string", format: "uuid" },
          quote_id: { type: "string", format: "uuid" },
          address: { $ref: "#/components/schemas/ShippingAddress" }
        }, ["parcel_id", "quote_id", "address"]),
        ShippingAddress: objectSchema({
          recipient_name: { type: "string" },
          line1: { type: "string" },
          line2: { type: "string" },
          city: { type: "string" },
          region: { type: "string" },
          postal_code: { type: "string" },
          country: { type: "string" },
          phone: { type: "string" }
        }, ["recipient_name", "line1", "city", "postal_code", "country", "phone"]),
        ShippingPaymentRequest: objectSchema({
          parcel_id: { type: "string", format: "uuid" },
          idempotency_key: { type: "string", maxLength: 120 }
        }, ["parcel_id", "idempotency_key"]),
        ShippingPaymentEnvelope: objectSchema({
          payment: { $ref: "#/components/schemas/ShippingPayment" },
          existing: { type: "boolean" }
        }, ["payment"]),
        ShippingPayment: objectSchema({
          id: { type: "string", format: "uuid" },
          parcel_id: { type: "string", format: "uuid" },
          payment_intent_id: { type: "string" },
          provider: { type: "string" },
          status: { type: "string" },
          amount_cents: { type: "integer" },
          amount: { type: "number" },
          currency: { type: "string" },
          created_at: { type: ["string", "null"], format: "date-time" },
          updated_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "parcel_id", "payment_intent_id", "provider", "status", "amount_cents", "currency"]),
        ShippingPaymentWebhookRequest: objectSchema({
          event_id: { type: "string" },
          payment_intent_id: { type: "string" },
          status: { type: "string" },
          amount_cents: { type: "integer" }
        }, ["event_id", "payment_intent_id", "status"]),
        ShippingWebhookResponse: objectSchema({
          event: { $ref: "#/components/schemas/ShippingWebhookEvent" },
          payment: { $ref: "#/components/schemas/ShippingPayment" },
          existing: { type: "boolean" }
        }, ["event", "payment"]),
        ShippingWebhookEvent: objectSchema({
          id: { type: "string", format: "uuid" },
          event_id: { type: "string" },
          payment_intent_id: { type: "string" },
          status: { type: "string" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "event_id", "payment_intent_id", "status"]),
        TrackingResponse: objectSchema({
          tracking: { $ref: "#/components/schemas/TrackingSummary" }
        }, ["tracking"]),
        TrackingSummary: objectSchema({
          parcel_id: { type: "string", format: "uuid" },
          status: { type: "string" },
          tracking_number: { type: ["string", "null"] },
          events: { type: "array", items: { $ref: "#/components/schemas/TrackingEvent" } }
        }, ["parcel_id", "status", "events"]),
        TrackingEvent: objectSchema({
          id: { type: "string", format: "uuid" },
          status: { type: "string" },
          location: { type: "string" },
          message: { type: "string" },
          occurred_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "status", "occurred_at"]),
        AdminParcelStatusRequest: objectSchema({
          status: { type: "string" },
          tracking_number: { type: "string" },
          location: { type: "string" },
          message: { type: "string" },
          occurred_at: { type: "string", format: "date-time" }
        }, ["status"]),
        WalletResponse: objectSchema({
          wallet: { $ref: "#/components/schemas/Wallet" },
          transactions: { type: "array", items: { $ref: "#/components/schemas/WalletTransaction" } },
          coupons: { type: "array", items: { $ref: "#/components/schemas/UserCoupon" } }
        }, ["wallet", "transactions", "coupons"]),
        Wallet: objectSchema({
          id: { type: "string", format: "uuid" },
          balance_cents: { type: "integer", minimum: 0 },
          balance: { type: "number", minimum: 0 },
          currency: { type: "string" },
          status: { type: "string" },
          created_at: { type: ["string", "null"], format: "date-time" },
          updated_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "balance_cents", "balance", "currency", "status"]),
        WalletTransaction: objectSchema({
          id: { type: "string", format: "uuid" },
          amount_cents: { type: "integer" },
          amount: { type: "number" },
          balance_after_cents: { type: "integer", minimum: 0 },
          balance_after: { type: "number", minimum: 0 },
          currency: { type: "string" },
          reason: { type: "string" },
          source_type: { type: "string" },
          source_id: { type: "string" },
          created_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "amount_cents", "balance_after_cents", "currency", "reason", "source_type"]),
        Coupon: objectSchema({
          id: { type: "string", format: "uuid" },
          code: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          status: { type: "string" },
          coupon_type: { type: "string" },
          discount_type: { type: "string" },
          amount_cents: { type: ["integer", "null"] },
          amount: { type: ["number", "null"] },
          percent_off: { type: ["integer", "null"] },
          max_discount_cents: { type: ["integer", "null"] },
          min_shipping_fee_cents: { type: "integer" },
          currency: { type: "string" },
          eligible_shipping_line_codes: { type: "array", items: { type: "string" } },
          combinable: { type: "boolean" },
          total_redemptions: { type: ["integer", "null"] },
          redeemed_count: { type: "integer" },
          per_user_limit: { type: "integer" },
          starts_at: { type: ["string", "null"], format: "date-time" },
          expires_at: { type: ["string", "null"], format: "date-time" },
          metadata: { type: "object", additionalProperties: true },
          created_at: { type: ["string", "null"], format: "date-time" },
          updated_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "code", "title", "status", "coupon_type", "discount_type", "currency"]),
        UserCoupon: objectSchema({
          id: { type: "string", format: "uuid" },
          status: { type: "string" },
          redeemed_source: { type: "string" },
          discount_cents: { type: ["integer", "null"] },
          locked_parcel_id: { type: ["string", "null"], format: "uuid" },
          used_parcel_id: { type: ["string", "null"], format: "uuid" },
          redeemed_at: { type: ["string", "null"], format: "date-time" },
          locked_at: { type: ["string", "null"], format: "date-time" },
          used_at: { type: ["string", "null"], format: "date-time" },
          coupon: { $ref: "#/components/schemas/Coupon" }
        }, ["id", "status", "coupon"]),
        RedeemCouponRequest: objectSchema({
          code: { type: "string" }
        }, ["code"]),
        UserCouponEnvelope: objectSchema({
          user_coupon: { $ref: "#/components/schemas/UserCoupon" },
          existing: { type: "boolean" }
        }, ["user_coupon"]),
        WelcomeGiftClaimEnvelope: objectSchema({
          claim: { $ref: "#/components/schemas/WelcomeGiftClaim" },
          user_coupon: { $ref: "#/components/schemas/UserCoupon" },
          existing: { type: "boolean" }
        }, ["claim"]),
        WelcomeGiftClaim: objectSchema({
          id: { type: "string", format: "uuid" },
          user_coupon_id: { type: ["string", "null"], format: "uuid" },
          claimed_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "claimed_at"]),
        ApplyCouponRequest: objectSchema({
          parcel_id: { type: "string", format: "uuid" },
          user_coupon_id: { type: "string", format: "uuid" }
        }, ["parcel_id", "user_coupon_id"]),
        CouponApplicationEnvelope: objectSchema({
          application: { $ref: "#/components/schemas/CouponApplication" },
          user_coupon: { $ref: "#/components/schemas/UserCoupon" },
          existing: { type: "boolean" }
        }, ["application", "user_coupon"]),
        CouponApplication: objectSchema({
          id: { type: "string", format: "uuid" },
          parcel_id: { type: "string", format: "uuid" },
          user_coupon_id: { type: "string", format: "uuid" },
          coupon_id: { type: "string", format: "uuid" },
          status: { type: "string" },
          discount_cents: { type: "integer" },
          discount: { type: "number" },
          original_final_fee_cents: { type: "integer" },
          final_fee_cents: { type: "integer" },
          final_fee: { type: "number" },
          created_at: { type: ["string", "null"], format: "date-time" },
          applied_at: { type: ["string", "null"], format: "date-time" },
          rolled_back_at: { type: ["string", "null"], format: "date-time" }
        }, ["id", "parcel_id", "user_coupon_id", "coupon_id", "status", "discount_cents", "final_fee_cents"]),
        AdminCouponRequest: objectSchema({
          code: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          status: { type: "string" },
          coupon_type: { type: "string" },
          discount_type: { type: "string" },
          amount: { type: "number" },
          amount_cents: { type: "integer" },
          percent_off: { type: "integer" },
          max_discount_cents: { type: "integer" },
          min_shipping_fee_cents: { type: "integer" },
          eligible_shipping_line_codes: { type: "array", items: { type: "string" } },
          combinable: { type: "boolean" },
          total_redemptions: { type: "integer" },
          per_user_limit: { type: "integer" },
          starts_at: { type: "string", format: "date-time" },
          expires_at: { type: "string", format: "date-time" },
          metadata: { type: "object", additionalProperties: true }
        }, ["code"]),
        AdminCouponEnvelope: objectSchema({
          coupon: { $ref: "#/components/schemas/Coupon" }
        }, ["coupon"]),
        WalletCreditRequest: objectSchema({
          amount_cents: { type: "integer" },
          amount: { type: "number" },
          reason: { type: "string", maxLength: 500 }
        }, ["reason"]),
        WalletCreditResponse: objectSchema({
          wallet: { $ref: "#/components/schemas/Wallet" },
          transaction: { $ref: "#/components/schemas/WalletTransaction" }
        }, ["wallet", "transaction"]),
        PoliciesResponse: objectSchema({
          policies: { type: "array", items: { $ref: "#/components/schemas/PolicyPage" } }
        }, ["policies"]),
        PolicyPage: objectSchema({
          policy_type: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          version: { type: "integer" },
          updated_at: { type: ["string", "null"], format: "date-time" },
          published_at: { type: ["string", "null"], format: "date-time" }
        }, ["policy_type", "title", "body", "version"]),
        HealthResponse: objectSchema({
          status: { const: "ok" },
          service: { type: "string", examples: [serviceName] },
          version: { type: "string", examples: [version] },
          uptime_s: { type: "integer", minimum: 0 },
          timestamp: { type: "string", format: "date-time" },
          request_id: { type: "string" }
        }, ["status", "service", "version", "uptime_s", "timestamp", "request_id"]),
        ReadyResponse: objectSchema({
          status: { const: "ready" },
          checks: {
            type: "array",
            items: { $ref: "#/components/schemas/DependencyCheck" }
          }
        }, ["status", "checks"]),
        VersionResponse: objectSchema({
          service: { type: "string", examples: [serviceName] },
          version: { type: "string", examples: [version] },
          environment: { type: "string" },
          git_sha: { type: "string" }
        }, ["service", "version", "environment", "git_sha"]),
        DependencyCheck: objectSchema({
          name: { type: "string" },
          required: { type: "boolean" },
          ok: { type: "boolean" },
          skipped: { type: "boolean" },
          reason: { type: "string" },
          message: { type: "string" },
          latency_ms: { type: "number", minimum: 0 },
          target: { type: "string" }
        }, ["name", "ok"]),
        ErrorEnvelope: objectSchema({
          error: {
            $ref: "#/components/schemas/ErrorBody"
          }
        }, ["error"]),
        ErrorBody: objectSchema({
          code: { type: "string" },
          message: { type: "string" },
          request_id: { type: "string" },
          details: { type: "object", additionalProperties: true }
        }, ["code", "message", "request_id"])
      }
    },
    "x-goatedbuy-service": serviceName
  };
}

function jsonResponse(description, schemaName) {
  return {
    description,
    content: {
      "application/json": {
        schema: {
          $ref: `#/components/schemas/${schemaName}`
        }
      }
    }
  };
}

function jsonRequest(schemaName) {
  return {
    required: true,
    content: {
      "application/json": {
        schema: {
          $ref: `#/components/schemas/${schemaName}`
        }
      }
    }
  };
}

function genericRequest() {
  return {
    required: false,
    content: {
      "application/json": {
        schema: { type: "object" }
      }
    }
  };
}

function okResponse(description) {
  return {
    description,
    content: {
      "application/json": {
        schema: { type: "object" }
      }
    }
  };
}

function pathParameter(name) {
  return {
    name,
    in: "path",
    required: true,
    schema: {
      type: "string"
    }
  };
}

function queryParameter(name, schema = { type: "string" }) {
  return {
    name,
    in: "query",
    required: false,
    schema
  };
}

function headerParameter(name, schema = { type: "string" }) {
  return { name, in: "header", required: true, schema };
}

function errorResponse(description) {
  return {
    description,
    content: {
      "application/json": {
        schema: {
          $ref: "#/components/schemas/ErrorEnvelope"
        }
      }
    }
  };
}

function objectSchema(properties, required = []) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required
  };
}
