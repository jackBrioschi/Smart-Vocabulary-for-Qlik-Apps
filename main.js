const enigma = require("enigma.js");
const schema = require("enigma.js/schemas/12.612.0");
const WebSocket = require("ws");
const OpenAI = require("openai");
const dotenv = require("dotenv");
// Load environment variables from .env.dev file
dotenv.config({ path: '.env.dev' });

// QIX interface or session apps, change this to an existing app guid if you intend to open that app:
// replace with your information
const appId = process.env.QLIK_CLOUD_APPID;
const tenant = process.env.QLIK_CLOUD_TENANT;
const apiKey = process.env.QLIK_CLOUD_APIKEY;
const url = `wss://${tenant}/app/${appId}`;

console.log('Connecting to Qlik app:', appId);
console.log('Tenant:', tenant);

// establish a connection to OpenAI APIs
 const client = new OpenAI({apiKey:process.env.OPENAI_APIKEY});


(async () => {
  const session = enigma.create({
    schema,
    createSocket: () =>
      new WebSocket(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
  });

  // bind traffic events to log what is sent and received on the socket:
  session.on("traffic:sent", (data) => console.log("sent:", data));
  session.on("traffic:received", (data) => console.log("received:", data));

  try {
    console.log('Opening session...');
    const global = await session.open();
    console.log('Session opened successfully');
    
    //Open app doc
    console.log('Opening app document...');
    const app = await global.openDoc(appId);
    console.log('App document opened successfully');

    //Retrieve all app infos to understand which are the id of the different components
    console.log('Retrieving app information...');
    const allInfos = await app.getAllInfos();
    console.log('App info retrieved. Total objects:', allInfos.length);

    //Retrieve only master measures and dimensions from allInfos
    const masterItems = allInfos.filter(item => 
      item.qType === 'measure' || item.qType === 'dimension'
    );
    console.log('Master items found:', masterItems.length);

    // Check if BusinessVocabulary object exists
    const vocabularyExists = allInfos.find(item => item.qId === 'BusinessVocabulary');
    let vocabulary;
    if (!vocabularyExists) {
      console.log('BusinessVocabulary object not found. Creating it...');
      // Create the vocabulary object if it doesn't exist
      const new_vocab = {
        qInfo: {qId: "BusinessVocabulary", qType: "BusinessVocabulary"},
        qMetaDef: {},
        vocabularies: [{entries: [], unresolvedEntries: [], sampleQueries: [], locale: "en"}]
      };
      
      // Create the vocabulary object
      vocabulary = await app.createObject({
        qProp: new_vocab
      });
      console.log('BusinessVocabulary object created successfully');
    } else {
      console.log('BusinessVocabulary object found, retrieving...');
      //Retrieve the vocabulary
      vocabulary = await app.getObject({"qId":"BusinessVocabulary"});
      console.log('BusinessVocabulary object retrieved successfully');
    }

    //getProperties to retrieve the content of the vocabulary
    const vocabulary_layout = await vocabulary.getProperties({}); 

    //Prepare the new layout to be filled with synonisms for each entry
    const new_vocab= {qInfo:{qId:"BusinessVocabulary",qType:"BusinessVocabulary"},qMetaDef:{},vocabularies:[{entries:[],unresolvedEntries:[], sampleQueries:[],locale:"en"}]};

    //Loop through the master items and retrieve metadata (title, description...)
    for (let x=0; x< masterItems.length; x++){
      try {
        if(masterItems[x].qType == 'measure'){
           var masterItem= await app.getMeasure({"qId":masterItems[x].qId});
        }
        else{
          var masterItem= await app.getDimension({"qId":masterItems[x].qId});
        }
        var masterProp = await masterItem.getProperties({});
        console.log("Master Item ", masterProp.qMetaDef.title);

        //Invoke OpenAI APIs for retrieving synonism
        const response = await client.responses.create({
            model: "gpt-4.1",
            input: "I need to fill a metadata vocabulary with synonyms of measures and dimensions for data analysis purposes. Can you give me an array of max 6 synonyms of the word "+masterProp.qMetaDef.title+" that users could use to query the data? I want as the output just an array, without any additional sentences. Where in a master measure you find the character '#' use it as 'number of' and please include within the synonysms also the current name. I also give you a bit more of context regarding what the term means: "+ masterProp.qMetaDef.description
        });
        const list_of_terms = response.output_text;

        
        var newTerm = {id: masterItems[x].qId,
                        terms:JSON.parse(list_of_terms),
                        appliedTo:[{"libItemRef":  masterItems[x].qId,}]
                      }
        console.log("New entry created ", JSON.stringify(newTerm))
        new_vocab.vocabularies[0].entries.push(newTerm);
      
        //Update the vocabulary
        const result_set = await vocabulary.setProperties({"qProp":new_vocab});  
      } catch (itemError) {
        console.log('Error processing master item:', masterItems[x].qId, itemError);
      }
    }
        
  } catch (err) {
    console.log('An unexpected error thrown:', err);
    console.log('Error details:', err.message);
    if (err.stack) {
      console.log('Stack trace:', err.stack);
    }
  }

  session.close();
})();