import {Text,View,Pressable,Image} from "react-native"
import {FC} from "react"
import {Styles} from "@/constants/Styles"
import { MenuItems } from "@/components/Menu"
import {Assets} from "@/constants/Assets"
import { useNavigation, useRoute } from "@react-navigation/native"
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import{RootStackParamList} from "@/App"
type Props = {
menuItem:MenuItems
}
export const MenuItem:FC<Props> = (props) =>{
const nav   = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
const route = useRoute();

// Tap behaviour:
//   - On a different screen           -> navigate normally (the target's
//                                         useFocusEffect fires on arrival
//                                         and refreshes the data)
//   - Already on this exact screen    -> replace the current route with
//                                         itself. React Navigation re-mounts
//                                         the component, which re-runs
//                                         useFocusEffect and visibly
//                                         refreshes the data the user
//                                         tapped the tab to see.
// Without this, tapping the same tab in a stack navigator was a no-op and
// the contractor would think the app was frozen.
const handlePress = () => {
  const target = props.menuItem.component as keyof RootStackParamList;
  if (route.name === target) {
    nav.replace(target as any);
    return;
  }
  nav.navigate(target as any);
};

return(<>
<Pressable onPress={handlePress}>
{
    ({pressed}) =>{

        return(<>
            {
                <View style={Styles.Menu.menuItem}>

                  {(props.menuItem.icon) ? <Image source={props.menuItem.icon || Assets.icons.HomeIcon} style={Styles.Menu.menuIcon}/> : null}
                    <Text style={
                        [
                            Styles.Menu.itemText,
                            {
                                color: (pressed) ? Styles.Menu.itemTextPressed.color : Styles.Menu.itemText.color
                            }
                        ]

                    }>{props.menuItem.label}</Text>


                </View>
            }
       </> )
    }
}
</Pressable>

</>)


}