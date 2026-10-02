import { type NextRequest, NextResponse } from "next/server";

interface GraphApiResponse {
  value?: any[];
  [key: string]: any;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId, appId, clientSecret } = body;

    if (!tenantId || !appId || !clientSecret) {
      return NextResponse.json(
        { error: "Missing required credentials" },
        { status: 400 }
      );
    }

    // Get access token for Microsoft Graph API
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: appId,
          client_secret: clientSecret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }),
      }
    );

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error("Graph auth error:", errorData);
      return NextResponse.json(
        { error: "Failed to authenticate with Microsoft Graph", details: errorData },
        { status: 401 }
      );
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Helper function to make Graph API calls
    const callGraphApi = async (endpoint: string, useBeta: boolean = false): Promise<GraphApiResponse | null> => {
      try {
        const apiVersion = useBeta ? "beta" : "v1.0";
        const response = await fetch(`https://graph.microsoft.com/${apiVersion}${endpoint}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Graph API error for ${endpoint}: ${response.status} - ${errorText}`);
          return null;
        }
        
        // Check if response has content
        const contentType = response.headers.get("content-type");
        const contentLength = response.headers.get("content-length");
        
        // If no content or content-length is 0, return empty result
        if (contentLength === "0" || !contentType?.includes("application/json")) {
          console.log(`Empty or non-JSON response for ${endpoint}`);
          return { value: [] };
        }
        
        const text = await response.text();
        if (!text || text.trim() === "") {
          console.log(`Empty response body for ${endpoint}`);
          return { value: [] };
        }
        
        try {
          return JSON.parse(text);
        } catch (parseError) {
          console.error(`Failed to parse JSON for ${endpoint}:`, parseError, "Response text:", text);
          return null;
        }
      } catch (error) {
        console.error(`Error calling ${endpoint}:`, error);
        return null;
      }
    };

    // Fetch organization details
    const orgData = await callGraphApi("/organization");
    const organization = orgData?.value?.[0] || {};

    // Fetch device configurations
    const deviceConfigs = await callGraphApi("/deviceManagement/deviceConfigurations");
    const deviceConfigCount = deviceConfigs?.value?.length || 0;

    // Fetch compliance policies
    const compliancePolicies = await callGraphApi("/deviceManagement/deviceCompliancePolicies");
    const compliancePolicyCount = compliancePolicies?.value?.length || 0;

    // Fetch configuration policies (Settings Catalog)
    // Note: Settings Catalog policies might need beta API for full results
    const configPolicies = await callGraphApi("/deviceManagement/configurationPolicies", true);
    const configPolicyCount = configPolicies?.value?.length || 0;

    // Fetch app protection policies (multiple endpoints needed)
    let appPolicyCount = 0;
    
    // iOS app protection policies
    const iosManagedAppPolicies = await callGraphApi("/deviceAppManagement/iosManagedAppProtections");
    appPolicyCount += iosManagedAppPolicies?.value?.length || 0;
    
    // Android app protection policies
    const androidManagedAppPolicies = await callGraphApi("/deviceAppManagement/androidManagedAppProtections");
    appPolicyCount += androidManagedAppPolicies?.value?.length || 0;
    
    // Windows Information Protection policies
    const windowsInfoProtectionPolicies = await callGraphApi("/deviceAppManagement/windowsInformationProtectionPolicies");
    appPolicyCount += windowsInfoProtectionPolicies?.value?.length || 0;
    
    // MDM Windows Information Protection policies
    const mdmWindowsInfoProtectionPolicies = await callGraphApi("/deviceAppManagement/mdmWindowsInformationProtectionPolicies");
    appPolicyCount += mdmWindowsInfoProtectionPolicies?.value?.length || 0;

    // Fetch managed devices
    const managedDevices = await callGraphApi("/deviceManagement/managedDevices");
    const totalDevices = managedDevices?.value?.length || 0;
    
    // Calculate compliance rate
    let complianceRate = 0;
    if (totalDevices > 0 && managedDevices?.value) {
      const compliantDevices = managedDevices.value.filter(
        (device: any) => device.complianceState === "compliant"
      ).length;
      complianceRate = Math.round((compliantDevices / totalDevices) * 100);
    }

    // Fetch users count
    const users = await callGraphApi("/users?$count=true&$top=1");
    const userCount = users?.["@odata.count"] || 0;

    // Prepare tenant details
    const tenantDetails = {
      organization: {
        id: organization.id || tenantId,
        displayName: organization.displayName || "Unknown Organization",
        verifiedDomains: organization.verifiedDomains || [],
        primaryDomain: organization.verifiedDomains?.find((d: any) => d.isDefault)?.name || 
                       organization.verifiedDomains?.[0]?.name || 
                       "pending.onmicrosoft.com",
      },
      statistics: {
        userCount,
        deviceCount: totalDevices,
        complianceRate,
        policies: {
          deviceConfigurations: deviceConfigCount,
          compliancePolicies: compliancePolicyCount,
          configurationPolicies: configPolicyCount,
          appProtectionPolicies: appPolicyCount,
          total: deviceConfigCount + compliancePolicyCount + configPolicyCount + appPolicyCount,
        },
      },
      // Calculate storage used (mock for now, would need actual backup data)
      storageUsed: totalDevices > 0 ? `${Math.round(totalDevices * 0.1)} MB` : "0 MB",
    };

    return NextResponse.json(tenantDetails);
  } catch (error) {
    console.error("Fetch tenant details error:", error);
    return NextResponse.json(
      { error: "Internal server error while fetching tenant details" },
      { status: 500 }
    );
  }
}