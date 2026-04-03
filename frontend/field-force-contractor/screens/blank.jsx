import {MainFrame} from "../components/MainFrame";
import {Text} from "react-native";
import { Styles } from "../constants/Styles";
export default function blank(){

    return(<>
    
        <MainFrame>
            <Text style={Styles.MainFrame.DefaultText}>Main Frame</Text>
        </MainFrame>
    
    
    </>)
}