import {Styles} from "../constants/Styles"
import {View, Text,Pressable,Image} from "react-native"
import {FC} from "react"
import {useState,useEffect,useRef} from "react"
import { MenuItem } from "./MenuItem"

type MenuVariant = "Menu1" | "Menu2" | "Menu3"
export type MenuItems = {label:string,icon?:string,component:string}
export type MenuOptions = [MenuVariant,items:MenuItems[]]
type Props = {
menuOptions?:MenuOptions
}
export const Menu:FC<Props> = (props) => {
    const [options,setIptions] = useState(props.menuOptions)
    const [menuStyle,setMenuStyle] = useState<any>(null);
    const [viewItem, setView] = useState<FC>();
  
    useEffect(()=>{
     
        setIptions(props.menuOptions);
        switch (options?.[0]){
        case "Menu1":
            setMenuStyle(Styles.Menu.container)
            setView(v1)
            break;
        case "Menu2":
            setMenuStyle(Styles.Menu.container)
            setView(v2)
            break;

        default:
            setMenuStyle(Styles.Menu.container)
        
        }


    },[options])
    const v1 = () => {
      return(
     <View  style={Styles.Menu.container}>
       {
       options?.[1].map((items,index) =>{
          return(<MenuItem key={index} menuItem={items}/>)

       })}
      </View>)

    }

    const v2 = () =>{
      return(
        <View style={Styles.Menu.container}>
          <Text style={Styles.TestStyles.Style1}>Testing View 2</Text>
        </View>
      )
    }
 
    return(
      viewItem 
    )

     
      
}
    
  

   

