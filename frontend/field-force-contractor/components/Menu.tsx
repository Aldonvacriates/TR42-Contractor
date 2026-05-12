import { RootStackParamList } from "@/App"
import { MenuItem } from "@/components/MenuItem"
import { Assets } from "@/constants/Assets"
import { Styles } from "@/constants/Styles"
import { AppContext } from "@/contexts/AppContext"
import { useNavigation } from "@react-navigation/native"
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { FC, useContext, useEffect, useState } from "react"
import { Image, Pressable, Text, View } from "react-native"
type MenuVariant = "Menu1" | "Menu2" |"Menu3" | "none"
export type MenuItems = {label:string,icon?:string,component:string}
export type MenuOptions = [variant : MenuVariant,items?:any[]] 

type Props = {
menuOptions?:MenuOptions 

}
export const Menu:FC<Props> = (props) => {

    const [viewItem, setView] = useState<any>()
    const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
   const {setMenuHeight} = useContext(AppContext)
    useEffect(()=>{
     
       
        switch (props.menuOptions?.[0]){
        case "Menu1":
            
            setView(v1)
            break;
        case "Menu2":
         
            setView(v2)
            break;
        case "Menu3":
            setView(v3)
             break;
        case "none":
      
          setView(null);
          break;

        default:
           setView(v1);
        
        }

    },[props.menuOptions])
    const v1 = () => {
      return(
     <View  style={Styles.Menu.MenuStyle1} onLayout={(event) =>{setMenuHeight(event.nativeEvent.layout.height)} }>
       {
       (props.menuOptions?.[1] || []).map((items,index) =>{
          return(<MenuItem key={index} menuItem={items}/>)

       })}
      </View>)

    }

    const v2 = () =>{
      return(
        <View style={Styles.Menu.MenuStyle2} onLayout={(event) =>{setMenuHeight(event.nativeEvent.layout.height)} }>
          <Pressable onPress={()=>{nav.goBack()}}>
          <Image source={Assets.icons.BackArrow} style={Styles.Menu.headMenuStyle2Icon}></Image>
          </Pressable>
          <Text style={Styles.Menu.headerMenuStyle2Text}>{(props.menuOptions?.[1]?.[0].label === undefined)? props.menuOptions?.[1]?.[0]: "Object Not Supported"}</Text>
        </View>
      )
    }
     const v3 = () =>{
      return(
        <View  style={Styles.Menu.MenuStyle3} onLayout={(event) =>{setMenuHeight(event.nativeEvent.layout.height)} }>
       {
       (props.menuOptions?.[1] || []).map((items,index) =>{
          return(<MenuItem key={index} menuItem={items}/>)

       })}
      </View>)
      
    }
 
    return(
      viewItem 
    )

     
      
}
    
  

   

