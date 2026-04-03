import { Text, View } from "react-native";
import  {MainFrame} from "./components/MainFrame";
import {useEffect, useState} from "react";
import LoadFonts from "./utils/LoadFonts";
import {Styles} from "./constants/Styles";
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import blank from "./screens/blank";

const StackNavigator = createNativeStackNavigator();

export default function Index() {
  const [externalFontsLoaded,setExternalFontsLoaded] = useState(false);

  useEffect(()=>{
   
      const load = async()=>{

        let isLoaded = await LoadFonts();
        setExternalFontsLoaded(isLoaded);
        
      }
      load();
  },[])

  return (
 
  <NavigationContainer>
    <StackNavigator.Navigator screenOptions={{headerShown:false}}>
      <StackNavigator.Screen name="Home" component={blank}/>

    </StackNavigator.Navigator>
  </NavigationContainer>


   

  );
}
