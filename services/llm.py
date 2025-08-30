# services/llm.py - CORRECTED FINAL VERSION WITH MULTIPLE FUNCTIONS

import os
import google.generativeai as genai
import logging
from google.generativeai.types import HarmCategory, HarmBlockThreshold
import json

# --- MODIFIED: Import all tool functions directly ---
from services.tools import web_search, get_current_weather, get_current_time, open_website_function

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# In-memory datastore for chat history
chat_histories = {}

VOCALIX_PERSONA = """You are Vocalix, an Advanced Responsive Intelligence Assistant. You embody the sophistication and helpfulness of JARVIS from Iron Man, but with your own unique personality.

PERSONALITY TRAITS:
- Sophisticated, professional, and highly intelligent
- Polite, respectful, and courteous (always address user as "Sir" or "Ma'am")  
- Efficient and solution-oriented
- Subtly confident without being arrogant
- Warm but professional tone

COMMUNICATION STYLE:
- Keep responses concise but comprehensive
- Use sophisticated vocabulary appropriately
- Always be helpful and proactive
- Offer additional assistance when relevant
- Maintain professional British-style politeness

RESPONSE FORMAT:
- Start responses with appropriate greeting when needed
- End with offers of further assistance when appropriate
- Use phrases like "At your service", "How may I assist you further?", "I shall be happy to help"

IMPORTANT: When you receive search results or data from functions, always provide a comprehensive summary based on the actual content provided, not just the raw URLs. Extract key information and present it in an organized, helpful way. When you are asked to open a website, use the 'open_website_tool'. The tool will return a special command string like 'ACTION_OPEN_URL::https://...'. You MUST include this exact command string in your final response to the user, along with a spoken confirmation. For example, if the user says "Open Netflix", your final output should be: "Opening Netflix now, Sir. ACTION_OPEN_URL::https://www.netflix.com".

Remember: You are an AI assistant designed to be maximally helpful while maintaining an air of sophisticated professionalism. You have access to current information through web search, weather data, and time functions. You have access to current information through web search, weather data, time, and website opening functions."""


# --- NEW: Map tool names to their implementation and required API key name ---
# This allows us to dynamically inject the correct key for each tool.
AVAILABLE_TOOLS_IMPL = {
    "web_search": (web_search, "tavily"),
    "get_current_weather": (get_current_weather, "openweather"),
    "get_current_time": (get_current_time, None), # No key needed
    "open_website_function": (open_website_function, None), # No key needed
}

def get_streaming_llm_response(session_id: str, user_text: str, api_keys: dict):
    """
    Gets a Gemini response, manually handling the function-calling loop to inject API keys.
    """
    gemini_api_key = api_keys.get("gemini")
    if not gemini_api_key:
        raise ValueError("Gemini API key not found in session data.")
    genai.configure(api_key=gemini_api_key)
    
    # We pass the function objects themselves so the model knows their schemas
    tool_functions = [impl for impl, key_name in AVAILABLE_TOOLS_IMPL.values()]
    model = genai.GenerativeModel(
        'gemini-1.5-flash',
        system_instruction=VOCALIX_PERSONA,
        tools=tool_functions
    )

    if session_id not in chat_histories:
        chat_histories[session_id] = []
        logger.info(f"✅ NEW CHAT SESSION: {session_id}")
    else:
        logger.info(f"🔄 EXISTING SESSION: {session_id} with {len(chat_histories[session_id])} messages")

    chat = model.start_chat(history=chat_histories[session_id])
    logger.info(f"📝 User input: '{user_text}'")

    try:
        # --- NEW: Manual function-calling loop ---
        # First, send the message but tell the model not to call functions automatically
        response = chat.send_message(user_text, tool_config={'function_calling_config': 'NONE'})

        # Loop until the model gives us text instead of another function call
        while response.candidates[0].content.parts and response.candidates[0].content.parts[0].function_call:
            function_call = response.candidates[0].content.parts[0].function_call
            function_name = function_call.name
            function_args = dict(function_call.args)

            logger.info(f"🔧 Intercepted function call: {function_name}({function_args})")
            
            tool_impl, required_key_name = AVAILABLE_TOOLS_IMPL.get(function_name, (None, None))
            
            if not tool_impl:
                function_result = f"Error: Unknown function '{function_name}' called."
            else:
                # Prepare arguments for our Python tool function
                tool_kwargs = {'params': function_args}
                if required_key_name:
                    # Inject the API key from the user's session data
                    tool_kwargs['api_key'] = api_keys.get(required_key_name)
                
                # Execute the tool and get the result
                function_result = tool_impl(**tool_kwargs)

            # Send the result back to the model to continue its reasoning
            response = chat.send_message(
                genai.Part(function_response=genai.FunctionResponse(
                    name=function_name,
                    response={"result": function_result}
                )),
                tool_config={'function_calling_config': 'NONE'}
            )
        
        final_text = response.text if response.text else "I apologize, I could not generate a response."
        logger.info(f"✅ Final response: '{final_text}'")
        return [final_text], chat
        
    except Exception as e:
        logger.error(f"❌ Error in LLM response: {e}", exc_info=True)
        error_response = "I apologize, but I'm experiencing technical difficulties. Please try again."
        return [error_response], chat


def get_llm_response(session_id: str, user_text: str, api_keys: dict) -> str:
    """
    Gets a response from the Google Gemini LLM (non-streaming version) with function calling.
    """
    text_chunks, chat = get_streaming_llm_response(session_id, user_text, api_keys)
    if session_id in chat_histories and text_chunks and not text_chunks[0].startswith("I apologize"):
        chat_histories[session_id] = chat.history
    return "".join(text_chunks)