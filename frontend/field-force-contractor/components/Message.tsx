import{Assets} from "@/constants/Assets"
import{Styles} from "@/constants/Styles"
import{FC} from "react"
import { Timespan } from "react-native/Libraries/Utilities/IPerformanceLogger"
import {Text,View} from "react-native"


export type MessageType = "sent" | "received"
type Props = {
    message?:string
    messageId?:number
    profileIcon?:string
    contactId?:string
    timeStamp?:Timespan
    messageType?:MessageType
}
export const Message:FC<Props> =(props) =>{

    return(<>
    <View style={(props.messageType === "received") ? Styles.Chat.messageBoxRecived : Styles.Chat.messageBoxSent}>
        <View style={(props.messageType === "received") ? Styles.Chat.MessageRecieved : Styles.Chat.MessageSent}>
            <Text style={Styles.Chat.MessageText}>{props.message}</Text>
        </View>
    </View>
    
    
    </>)

}