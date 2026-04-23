import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  TextInput,
  View,
} from "react-native";
import { LoadFonts } from "./utils/LoadFonts";

// Dark translucent keyboard on iOS for every TextInput in the app
(TextInput as any).defaultProps = {
  ...((TextInput as any).defaultProps ?? {}),
  keyboardAppearance: "dark",
};

import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";

import { AppContext } from "./contexts/AppContext";
import { screenConfig } from "./constants/ScreenConfig";
import { Blank } from "./screens/Blank";
import { Chat } from "./screens/ChatScreen";
import { Contacts } from "./screens/ContactScreen";
import DriveTimeTrackerScreen from "./screens/DriveTimeTrackerScreen";
import HomeScreen from "./screens/HomeScreen";
import { InspectionAssistScreen } from "./screens/InspectionAssistScreen";
import InspectionScreen from "./screens/InspectionScreen";
import { SavedReportsScreen } from "./screens/SavedReportsScreen";
import SessionLockScreen from "./screens/SessionLockScreen";
import { SplashScreen } from "./screens/SplashScreen";
import TicketDetailScreen from "./screens/TicketDetailScreen";
import TicketsScreen from "./screens/TicketsScreen";

import BiometricScreen from "./screens/BiometricScreen";
import LoginScreen from "./screens/LoginScreen";
import OfflineLoginScreen from "./screens/OfflineLoginScreen";
import OfflinePinResetScreen from "./screens/OfflinePinResetScreen";
import PasswordResetScreen from "./screens/PasswordResetScreen";

import LicenseScreen from "./screens/LicenseScreen";
import ProfileScreen from "./screens/ProfileScreen";
import TaskHistoryScreen from "./screens/TaskHistoryScreen";

export type RootStackParamList = {
  SplashScreen: undefined;

  Home: undefined;
  Blank: undefined;
  Contacts: undefined;
  Chat: { name: string; contactId?: string };
  Tickets: undefined;
  TicketDetail: { taskId: number };
  JobDetail: { jobId: string; workOrderId: string };
  WorkOrders: undefined;

  Login: undefined;
  OfflineLogin: undefined;
  BiometricCheck: {
    pendingToken: string;
    pendingUser: { id: number; username: string; role: string };
  };
  PasswordReset: undefined;
  OfflinePinReset: undefined;

  Profile: undefined;
  LicenseDetails: undefined;
  TaskHistory: undefined;

  Inspection: { bypassGate?: boolean } | undefined;
  InspectionAssist: undefined;
  DriveTimeTracker: undefined;
  SavedReports: undefined;
  SessionLock: undefined;
  Dashboard: undefined;
};

const StackNavigator = createNativeStackNavigator<RootStackParamList>();

function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const [isSessionLocked, setIsSessionLocked] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (!isAuthenticated) {
      setIsSessionLocked(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      const prevAppState = appStateRef.current;

      if (
        isAuthenticated &&
        prevAppState === "active" &&
        (nextAppState === "inactive" || nextAppState === "background")
      ) {
        setIsSessionLocked(true);
      }

      appStateRef.current = nextAppState;
    });

    return () => subscription.remove();
  }, [isAuthenticated]);

  const handleSessionUnlock = useCallback(() => {
    setIsSessionLocked(false);
  }, []);

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#0a0a0a",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return (
    <StackNavigator.Navigator
      screenOptions={screenConfig.window}
      initialRouteName="SplashScreen"
    >
      {isSessionLocked ? (
        <StackNavigator.Screen name="SessionLock">
          {() => <SessionLockScreen onUnlock={handleSessionUnlock} />}
        </StackNavigator.Screen>
      ) : (
        <>
          <StackNavigator.Screen
            name="SplashScreen"
            component={SplashScreen}
          />
          <StackNavigator.Screen name="Inspection" component={InspectionScreen} />
          <StackNavigator.Screen name="Dashboard" component={HomeScreen} />
          <StackNavigator.Screen name="Home" component={HomeScreen} />
          <StackNavigator.Screen name="Blank" component={Blank} />
          <StackNavigator.Screen name="Contacts" component={Contacts} />
          <StackNavigator.Screen name="Chat" component={Chat} />
          <StackNavigator.Screen name="Tickets" component={TicketsScreen} />
          <StackNavigator.Screen
            name="TicketDetail"
            component={TicketDetailScreen}
          />
          <StackNavigator.Screen name="Profile" component={ProfileScreen} />
          <StackNavigator.Screen
            name="LicenseDetails"
            component={LicenseScreen}
          />
          <StackNavigator.Screen
            name="TaskHistory"
            component={TaskHistoryScreen}
          />
          <StackNavigator.Screen
            name="InspectionAssist"
            component={InspectionAssistScreen}
          />
          <StackNavigator.Screen
            name="DriveTimeTracker"
            component={DriveTimeTrackerScreen}
          />
          <StackNavigator.Screen
            name="SavedReports"
            component={SavedReportsScreen}
          />
          <StackNavigator.Screen name="Login" component={LoginScreen} />
          <StackNavigator.Screen
            name="OfflineLogin"
            component={OfflineLoginScreen}
          />
          <StackNavigator.Screen
            name="BiometricCheck"
            component={BiometricScreen}
          />
          <StackNavigator.Screen
            name="PasswordReset"
            component={PasswordResetScreen}
          />
          <StackNavigator.Screen
            name="OfflinePinReset"
            component={OfflinePinResetScreen}
          />
        </>
      )}
    </StackNavigator.Navigator>
  );
}

export default function App() {
  const [externalFontsLoaded, setExternalFontsLoaded] = useState(false);
  const [mount, setMounted] = useState(false);

  useEffect(() => {
    const load = async () => {
      const isLoaded = await LoadFonts();
      setExternalFontsLoaded(isLoaded);
    };

    load();
  }, []);

  if (!externalFontsLoaded) return null;

  return (
    <AppContext.Provider value={[mount, setMounted]}>
      <ThemeProvider>
        <AuthProvider>
          <NavigationContainer>
            <RootNavigator />
          </NavigationContainer>
        </AuthProvider>
      </ThemeProvider>
    </AppContext.Provider>
  );
}
