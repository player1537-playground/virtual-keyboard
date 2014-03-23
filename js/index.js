'use strict';
/* ==== Constants ==== */
var ACCELERATION_RECORDS = 4;
var BUFFER_ITEMS = 5;
var KEY_THRESHOLD = 5;
var TYPEABLE_ALPHABET = "abcdefghijklmnopqrstuvwxyz";
var TRAINING_TEXTS = [
    "the quick brown fox jumps over the lazy dog",
    "how quickly daft jumping zebras vex",
    TYPEABLE_ALPHABET,
    "jinxed wizards pluck ivy from the big quilt",
];
var MAX_ITERATIONS = 1000;
var TARGET_ERROR = 0.1;


/* ==== Globals ==== */
var accelX = [];
var accelY = [];
var accelZ = [];
var accelMag = [];

var windowWidth = window.innerWidth;
var windowHeight = window.innerHeight;

var graph = d3.select('#graph');

var bufferX = [];
var bufferY = [];
var bufferZ = [];

var currentTrainingTextIndex = 0;
var currentTrainingCharIndex = 0;

/* ==== Helper Functions ==== */
function addToArray(array, item) {
    array.push(item);
    if (array.length > ACCELERATION_RECORDS) {
        array.shift();
    }
}

function addAccelData(x, y, z) {
    var keyPressed = false;
    bufferX.push(x);
    bufferY.push(y);
    bufferZ.push(z);

    if (bufferX.length == BUFFER_ITEMS) {
        var avgx = d3.sum(bufferX) / BUFFER_ITEMS;
        var avgy = d3.sum(bufferY) / BUFFER_ITEMS;
        var avgz = d3.sum(bufferZ) / BUFFER_ITEMS;
        var avgmag = Math.sqrt(avgx*avgx + avgy*avgy + avgz*avgz);

        if (abs(avgmag - d3.sum(accelMag) / accelMag.length) > KEY_THRESHOLD) {
            keyPressed = true;
        }

        addToArray(accelX, avgx);
        addToArray(accelY, avgy);
        addToArray(accelZ, avgz);
        addToArray(accelMag, avgmag);
        
        redrawGraph();

        bufferX = [];
        bufferY = [];
        bufferZ = [];
    }
    if (keyPressed) {
        if (training) {
            train();
        } else {
            detectKey();
        }
    }
}

function redrawGraph() {
    var margins = { x: { left: 10, right: 10 },
                    y: { top: 10, bottom: 10 } };
    var width = windowWidth - margins.x.left - margins.x.right;
    var height = windowHeight - margins.y.top - margins.y.bottom;
    
    /* Source for colors: http://ksrowell.com/blog-visualizing-data/2012/02/02/optimal-colors-for-graphs/ */
    var datas = [ { data: accelX, color: "rgb(57,106,177)" },
                  { data: accelY, color: "rgb(218,124,48)" },
                  { data: accelZ, color: "rgb(62,150,81)" },
                  { data: accelMag, color: "rgb(204,37,41)" } ];

    var x = d3.scale.linear()
        .domain([0, datas[0].data.length])
        .range([0, width]);
    var y = d3.scale.linear()
        .domain([d3.min(datas.map(function(d) { return d3.min(d.data); })),
                 d3.max(datas.map(function(d) { return d3.max(d.data); }))])
        .range([height, 0]);

    var line = d3.svg.line()
        .x(function(d, index) {
            return x(index);
        })
        .y(function(d) {
            return y(d);
        })


    graph.selectAll("path")
        .remove();
    graph.selectAll("g")
        .remove();


    var g = graph
        .attr("width", width + margins.x.left + margins.x.right)
        .attr("height", height + margins.y.top + margins.y.bottom)
      .append("g")
        .attr("transform", "translate(" + margins.x.left + "," + margins.y.top + ")");
    
    g.selectAll("path")
        .data(datas)
      .enter().append("path")
        .attr("d", function(d) { return line(d.data); })
        .style("stroke", function(d) { return d.color; });

    /*
    datas.forEach(function(data) {
        graph.append("path")
            .attr("d", line(data));
    });
    */
}

function motionHandler(e) {
    addAccelData(e.acceleration.x, e.acceleration.y, e.acceleration.z);
}

/* ==== Neural Network ==== */
var neural = (function() {
    var INPUT = undefined;
    var IDEAL = undefined;
    var network = undefined;
    var trainer = undefined;
    var iteration = undefined;
    
    function getCharacterIndex(c) {
        var index = TYPEABLE_ALPHABET.indexOf(c);
        if (index == -1) {
            console.log("Not a typeable character: '" + c + "'");
        }
        return index;
    }

    function initializeNetwork() {
        INPUT = [];
        IDEAL = [];
        network = ENCOG.BasicNetwork.create([
            ENCOG.BasicLayer.create(ENCOG.ActivationSigmoid.create(),
                                    2,
                                    ACCELERATION_RECORDS * BUFFER_ITEMS * 3 + 1),
            ENCOG.BasicLayer.create(ENCOG.ActivationSigmoid.create(),
                                    ACCELERATION_RECORDS * BUFFER_ITEMS,
                                    0),
            ENCOG.BasicLayer.create(ENCOG.ActivationSigmoid.create(),
                                    ACCELERATION_RECORDS * BUFFER_ITEMS,
                                    0),
            ENCOG.BasicLayer.create(ENCOG.ActivationSigmoid.create(),
                                    1,
                                    0)]);
        trainer = ENCOG.PropagationTrainer.create(network,
                                                  INPUT,
                                                  IDEAL,
                                                  "RPROP",
                                                  0, 
                                                  0);
        iteration = 1;
    }

    function addTrainingCase(accelX, accelY, accelZ, character, ideal) {
        var input = [].concat(accelX, accelY, accelZ, getCharacterIndex(character));
        INPUT.push(input);
        IDEAL.push(ideal);
    }
    
    function train() {
        do {
            trainer.iteration();
            console.log("Training Iteration #" + iteration + ", Error: " + train.error);
        } while (iteration++ < MAX_ITERATIONS && trainer.error > TARGET_ERROR);
    }
    
    function getCharacter(accelX, accelY, accelZ) {
        var inputStub = [].concat(accelX, accelY, accelZ)
        var outputs = TYPEABLE_ALPHABET.map(function(c) {
            var output = new Array(1);
            var input = inputStub.concat(getCharacterIndex(c));
            network.compute(input, output);
            return { character: c, output: output };
        });
        return d3.max(outputs, function(d) { return d.output; }).character;
    }
    
    return {
        initializeNetwork: initializeNetwork,
        train: train,
        addTrainingCase: addTrainingCase,
        getCharacter: getCharacter,
    }
})();

/* ==== Main Code ==== */
console.log("Hoping anything works at all");
console.log("[w, h] = [" + windowWidth + "," + windowHeight +"]");
if (window.DeviceMotionEvent) {
    console.log("Starting devicemotion listener");
    if (windowWidth > 800) {
        setInterval(function() {
            addAccelData(Math.random() * 10,
                         Math.random() * 10,
                         Math.random() * 10);
        }, 50);
    } else {
        window.addEventListener('devicemotion', motionHandler);
    }
} else {
    alert('Your browser does not support DeviceMotion');
}
