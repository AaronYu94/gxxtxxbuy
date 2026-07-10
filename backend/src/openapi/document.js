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
      "/admin/coupons": {
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
