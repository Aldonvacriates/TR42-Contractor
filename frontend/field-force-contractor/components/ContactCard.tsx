import { Styles } from "@/constants/Styles";
import { Assets } from "@/constants/Assets";
import {View,Text,Image,Pressable} from "react-native"
import {FC} from "react"

type Props = {

    profileIcon?: string
    phoneNumber?: number
    contactId?: number
}
export const ContactCard:FC<Props> = (props) =>{

  return(<>
  
  <View style={Styles.Contacts.container}>
   <Text style={Styles.Menu.itemText}>Test</Text>
  </View>
  
  </>)

}