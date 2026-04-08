import {Styles} from "../constants/Styles"
import {View, Text,Pressable} from "react-native"
import {FC} from "react"
import {useState,useEffect} from "react"
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
    
    useEffect(()=>{
     
        setIptions(props.menuOptions);
        switch (options?.[0]){
        case "Menu1":
            setMenuStyle(Styles.Menu.container)
            break;
        case "Menu2":
            setMenuStyle(Styles.Menu.container)
            break;

        default:
            setMenuStyle(Styles.Menu.container)
        
        }


    },[options])

    return(<>
    {
    (options)?  
    <View style={menuStyle}>
     
      {
        
       options[1].map((items, index) =>{
          console.log(items.label);
        return(

          <MenuItem key={index} menuItem={items}/>

        )
       })
      }

    </View> :null
}
  </>)
   

}