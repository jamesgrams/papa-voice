const Sonus = require("sonus");
const speech = require("@google-cloud/speech");
const client = new speech.SpeechClient();
const proc = require("subprocess");
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

const START_HARMONY_API_COMMAND = "lib/harmony/script/server";
const HOTWORDS = [{ file: 'resources/sophia.udml', hotword: 'sophia' }];
const LANGUAGE = "en-US";
const RECORD_PROGRAM = "arecord"; // recommended for Pi
const CHARLOTTE_URL = "https://www.tvpassport.com/lineups/set/95354D?lineupname=Spectrum+-+Charlotte%2C+NC+&tz=America/New_York";
const LINEUP_INTERVAL = 1000 * 60 * 5;

const sonus = Sonus.init({ HOTWORDS, LANGUAGE, recordProgram: RECORD_PROGRAM }, client);

let lineup = {};

/**
 * List of commands
 *      On
 *      Off
 *      Volume Down
 *      Volume Up
 *      Spectrum
 *      Roku
 *      Amazon
 *      Watch <Channel>
 *      Watch <Keyword - Channel, Type(Movie or Sport), or Keyword in name>
 */

/**
 * Main function.
 */
async function main() {
    // Start harmony server
    proc.exec(START_HARMONY_API_COMMAND); // harmony is running on port 8282

    fetchLineup();

    Sonus.start(sonus);
    sonus.on('hotword', (index, keyword) => console.log("!"));
    sonus.on("final-result", result => {
        result = result.toLowerCase();
        switch(result) {
            case "on":

            case "off":

            case "volume down":

            case "volume up":

            case "spectrum":

            case "roku":

            case "amazon":

            default:
                if( result.match(/^watch/) ) {

                }

        }
    });
    sonus.on("error", error => console.log("error", error));
}

/**
 * Fetch lineup.
 */
async function fetchLineup() {
    try {
        let response = await axois.get(CHARLOTTE_URL);
        let dom = new JSDOM(response.data);
        let channels = dom.querySelectorAll(".channel_col");
        let newLineup = {};
        channels.forEach( el => {
            let number = el.querySelector(".channel-number").innerHTML
            let listingCell = el.nextElementSibling.querySelector(".listing_cell");
            let channel = {
                name: el.querySelector(".channel_cell").getAttribute("title"),
                program: {
                    show: listingCell.querySelector("showtitle").innerHTML,
                    episode: listingCell.querySelector(".episode-title") ? listingTitles.querySelector(".episode-title").innerText : "",
                    type: listingCell.classList.contains("showtype-O") ? "sport" : listingCell.classList.contains("showtype-M") ? "movie" : ""
                }
            };
            newLineup[number] = channel;
        } );
        lineup = newLineup;
    }
    catch(err) {
        console.log(err);
    }
    setTimeout(fetchLineup, LINEUP_INTERVAL);
}

main();