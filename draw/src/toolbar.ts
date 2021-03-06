import { MultiLineLayer, MultilineTextSymbol } from './multi-line';

// create observable so plugin user can subscribe to plugin events like for the viewer api
import { Subject } from 'rxjs';

export class DrawObs {
    private _drawPoint = new Subject();
    private _drawPolyline = new Subject();
    private _drawPolygon = new Subject();
    private _drawExtent = new Subject();

    // observable function
    subsDrawPoint(geometry) {
        this._drawPoint.next(geometry);
    }
    subsDrawPolyline(geometry) {
        this._drawPolyline.next(geometry);
    }
    subsDrawPolygon(geometry) {
        this._drawPolygon.next(geometry);
    }
    subsDrawExtent(geometry) {
        this._drawExtent.next(geometry);
    }

    // observables available to user
    drawPoint = this._drawPoint.asObservable();
    drawPolyline = this._drawPolyline.asObservable();
    drawPolygon = this._drawPolygon.asObservable();
    drawExtent = this._drawExtent.asObservable();
}
(<any>window).drawObs = new DrawObs();

export class DrawToolbar {
    private _mapApi: any;
    private _config: any;

    private _toolbar: any;
    private _bundle: any;
    private _geometryService: any;

    private _activeTool: string = '';
    private _activeColor: number[] = [255,0,0,1];
    private _activeGraphic: object;
    private _identifyMode: object;

    private _mapPoint: object[] = [];
    private _geomLength: number = 0;
    private _extentPoints: object[] = [];

    private _graphicKey: string;

    private _areaParams: object;
    private _lengthParams: object;
    private _distanceParams: object;
    private _showMeasure: boolean = true;

    private _local: object;

    /**
     * Toolbar constructor
     * @constructor
     * @param {Any} mapApi the viewer api
     * @param {Any} config the viewer configuration
     */
    constructor(mapApi: any, config: any) {
        this._mapApi = mapApi;
        this._config = config

        // keep track of identifier mode to set it back when toolbar is deactivated
        this._identifyMode = this._mapApi.layersObj._identifyMode;

        // set hide/show measure from presence of measure tool
        this._showMeasure = (config.tools.indexOf('measure') === -1) ? false : true;

        // add needed dependencies
        let myBundlePromise = (<any>window).RAMP.GAPI.esriLoadApiClasses([
            ['esri/toolbars/draw', 'esriTool'],
            ['esri/graphic', 'Graphic'],
            ['esri/symbols/TextSymbol', 'TextSymbol'],
            ['esri/symbols/SimpleMarkerSymbol', 'SimpleMarkerSymbol'],
            ['esri/symbols/SimpleLineSymbol', 'SimpleLineSymbol'],
            ['esri/symbols/SimpleFillSymbol', 'SimpleFillSymbol'],
            ['esri/geometry/ScreenPoint', 'ScreenPoint'],
            ['dojo/i18n!esri/nls/jsapi', 'i18n'],
            ['esri/tasks/GeometryService', 'GeomService'],
            ['esri/tasks/DensifyParameters', 'DensifyParams'],
            ['esri/tasks/DistanceParameters', 'DistanceParams'],
            ['esri/tasks/LengthsParameters', 'LengthParams'],
            ['esri/tasks/AreasAndLengthsParameters', 'AreaParams'],
            ['esri/geometry/Point', 'Point'],
            ['esri/geometry/Polygon', 'Polygon']
        ]);

        myBundlePromise.then(myBundle => {
            this.initToolbar(myBundle);

            // set tooltip for esri Draw toolbar
            var point = {
                'en-CA': {
                    addPoint: 'Click to add a point'
                },
                'fr-CA': {
                    addPoint: 'Cliquez pour ajouter un point'
                }
            };

            var polyline = {
                'en-CA': {
                    complete: 'Double-click to end line',
                    resume: 'Click to end line segment',
                    start: 'Click to start line segment'
                },
                'fr-CA': {
                    complete: 'Double-cliquez pour terminer la ligne',
                    resume: 'Cliquez pour terminer le segment de ligne',
                    start: 'Cliquez pour commencer le segment de ligne'
                }
            };

            var polygon = {
                'en-CA': {
                    complete: 'Double-click to close polygon',
                    resume: 'Click to end polygon segment',
                    start: 'Click to start polygon segment'
                },
                'fr-CA': {
                    complete: 'Double-cliquez pour fermer le polygone',
                    resume: 'Cliquez pour terminer le segment de polygone',
                    start: 'Cliquez pour commencer le segment de polygone'
                }
            };

            var extent = {
                'en-CA': {
                    freehand: 'Press down to start and let go to finish'
                },
                'fr-CA': {
                    freehand: 'Appuyez pour commencer et laissez aller pour finir'
                }
            };

            this._local = { point, polyline, polygon, extent };
        });

        // create graphics layer
        this._mapApi.layersObj.addLayer('graphicsRvColl');

        // create geometry service and set event for measures
        this._geometryService = (<any>window).RAMP.GAPI.esriBundle.GeometryService(config.url);
        this._geometryService.on('distance-complete', (evt) => { this.outputDistance(evt); });
        this._geometryService.on('areas-and-lengths-complete', (evt) => { this.outputAreaAndLength(evt, this._activeGraphic); });
        this._geometryService.on('lengths-complete', (evt) => { this.outputLength(evt, this._activeGraphic); });
        this._geometryService.on('label-points-complete', (evt) => { this.labelPoint(evt, this._activeGraphic); });

        MultiLineLayer.setMultiLine();
        MultilineTextSymbol.setMultiLine();

        return this;
    }

    /**
     * Initialize the toolbar
     * @function initToolbar
     * @param {any} myBundle esri dependencies bundle
     */
    initToolbar(myBundle) {
        this._bundle = myBundle;
        this._toolbar = new this._bundle.esriTool(this._mapApi.esriMap);

        // set measurement parameters
        this._distanceParams = new this._bundle.DistanceParams();
        (<any>this)._distanceParams.distanceUnit = this._bundle.GeomService.UNIT_KILOMETER;
        (<any>this)._distanceParams.geodesic = true;

        this._lengthParams = new this._bundle.LengthParams();
        (<any>this)._lengthParams.lengthUnit = this._bundle.GeomService.UNIT_KILOMETER;
        (<any>this)._lengthParams.geodesic = true;

        this._areaParams = new this._bundle.AreaParams();
        (<any>this)._areaParams.lengthUnit = this._bundle.GeomService.UNIT_KILOMETER;
        (<any>this)._areaParams.areaUnit = this._bundle.GeomService.UNIT_SQUARE_KILOMETERS;
        (<any>this)._areaParams.calculationType = 'preserveShape';

        // define on draw complete event
        let that = this;
        this._toolbar.on('draw-complete', evt => { this.addToMap(evt); });

        // define pan and zoom event to redraw text
        this._mapApi.esriMap.on('pan-end', () => { setTimeout(() => this.createBackground(), 0); });
        this._mapApi.esriMap.on('zoom-end', () => { setTimeout(() => this.createBackground(), 0); });
    }

    /**
     * get active tool
     * @property activeTool
     * @return {string} active tool name
     */
    get activeTool(): string {
        return this._activeTool;
    }
    /**
     * set active tool
     * @property activeTool
     * @param {string} value tool name
     */
    set activeTool(value: string) {
        // set tooltips, then activate tool for esri tool or deactivate
        if (['point', 'polyline', 'polygon', 'extent'].indexOf(value) > -1) {
            this._bundle.i18n.toolbars.draw = this._local[value][this._config.language];
            this._toolbar.activate(this._bundle.esriTool[value.toUpperCase()]);
            this.disableDetails(true);
        } else {
            this._toolbar.deactivate();
            this.disableDetails(false);
        }

        this._activeTool = value;
    }

    /**
     * get active color
     * @property activeColor
     * @return {Number[]} active color
     */
    get activeColor(): number[] {
        return this._activeColor;
    }
    /**
     * set active color
     * @property activeColor
     * @param {Number[]} value active color
     */
    set activeColor(value: number[]) {
        this._activeColor = value;
    }

    /**
     * get geometry length
     * @property geometryLength
     * @return {number} geometry length
     */
    get geometryLength(): number {
        return this._geomLength;
    }
    /**
     * set geometry length
     * @property geometryLength
     * @param {number} value geometry length
     */
    set geometryLength(value: number) {
        this._geomLength = value;
    }

    /**
     * get geometry points
     * @property mapPoints
     * @return {Object} geometry length
     */
    get mapPoints(): object[] {
        return this._mapPoint;
    }
    /**
     * set geometry points
     * @property mapPoints
     * @param {Object[]} value geometry length
     */
    set mapPoints(value: object[]) {
        this._mapPoint = value;

        if (value.length === 2) {
            // get length measure
            (<any>this)._distanceParams.geometry1 = value[0];
            (<any>this)._distanceParams.geometry2 = value[1];
            this._geometryService.distance((<any>this)._distanceParams);
        }
    }

    /**
     * get graphic key
     * @property graphicKey
     * @return {String} graphic key
     */
    get graphicKey(): string {
        return this._graphicKey;
    }
    /**
     * set graphic key
     * @property graphicKey
     * @param {String} value graphic key
     */
    set graphicKey(value: string) {
        this._graphicKey = value;
    }

    /**
     * get graphic layer
     * @property graphicsLayer
     * @return {Any} graphic layer
     */
    get graphicsLayer(): any {
        return this._mapApi.esriMap._layers.graphicsRvColl;
    }

    /**
     * Import graphics file to graphiclayer
     * @function importGraphics
     * @param {Oject[]} graphics array of graphics to load
     */
    importGraphics(graphics) {
        for (let item of graphics) {
            let graphic = new this._bundle.Graphic(item);

            // color doesn't always transfert properly, overwrite it
            graphic.symbol.color = item.symbol.color
            if (typeof graphic.symbol.outline !== 'undefined') {
                graphic.symbol.outline.color = item.symbol.outline.color;
            }

            // add the key for measure then add to layer
            graphic.key = item.key;
            this.graphicsLayer.add(graphic);
        }

        this.createBackground();
    }

    /**
     * Export graphics to file from graphiclayer
     * @function exportGraphics
     * @return {String} JSON array of graphics stringnify
     */
    exportGraphics(): string {
        const graphics = this.graphicsLayer.graphics;

        let output = [];
        for (let graphic of graphics) {
            // do not keep text background, it will regenerated
            if (typeof graphic.geometry !== 'undefined') {
                // keep the key to link to measure
                let json = graphic.toJson();
                json.key = graphic.key;

                // color doesn't always transfert properly, overwrite it
                json.symbol.color = graphic.symbol.color
                if (typeof json.symbol.outline !== 'undefined') {
                    json.symbol.outline.color = [
                        graphic.symbol.outline.color.r,
                        graphic.symbol.outline.color.g,
                        graphic.symbol.outline.color.b,
                        graphic.symbol.outline.color.a
                    ];
                }
                output.push(json);
            }
        }

        return JSON.stringify(output);
    }

    /**
     * Disable/enable details panel
     * @function disableDetails
     * @param {Boolean} value true to enable, false to disable
     */
    disableDetails(value: boolean) {
        this._mapApi.layersObj._identifyMode = value ? [] : this._identifyMode;
    }

    /**
     * Simulate click for keyboard user (WCAG)
     * @function simulateClick
     * @param {Number[]} pt array of lat/long
     * @param {String} mouse mouse event
     */
    simulateClick(pt: number[], mouse: string) {
        // convert screen click to map then emit the event (click or double click)
        const mapPoint = this._mapApi.esriMap.toMap(new this._bundle.ScreenPoint({ x: pt[0], y: pt[1] }));
        this._mapApi.esriMap.emit(mouse, { mapPoint: new this._bundle.Point(mapPoint.x, mapPoint.y, this._mapApi.esriMap.spatialReference) }); 
    }

    /**
     * Set extent point
     * @function setExtentPoints
     * @param {Number[]} value array of lat/long
     * @param {Boolean} final true if last point, false otherwise
     */
    setExtentPoints(value: number[], final: boolean) {
        if (final && this._extentPoints.length === 1) {
            const pt = this._mapApi.esriMap.toMap(new this._bundle.ScreenPoint({ x: value[0], y: value[1] }));
            const geometry = {
                xmin: (<any>this)._extentPoints[0].x,
                ymin: (<any>this)._extentPoints[0].y,
                xmax: pt.x,
                ymax: pt.y
            }

            this.deleteGraphics(geometry);
            this._extentPoints = [];
        } else {
            this._extentPoints[0] = this._mapApi.esriMap.toMap(new this._bundle.ScreenPoint({ x: value[0], y: value[1] }));
        }
    }

    /**
     * Add geometry to map
     * @function addToMap
     * @param {Any} event esri toolbar event
     */
    addToMap(evt: any) {
        switch ((<any>evt).geometry.type) {
            case 'point':
                // trigger observable
                (<any>window).drawObs.subsDrawPoint(evt.geometry);

                this.addGraphic(evt.geometry, new this._bundle.SimpleMarkerSymbol());
                break;
            case 'polyline':
                // trigger observable
                (<any>window).drawObs.subsDrawPolyline(evt.geometry);

                // get length measure
                this._activeGraphic = evt.geometry;
                (<any>this)._lengthParams.polylines = [evt.geometry];
                this._geometryService.lengths((<any>this)._lengthParams);

                this.addGraphic(evt.geometry, new this._bundle.SimpleLineSymbol());
                break;
            case 'polygon':
                // trigger observable
                (<any>window).drawObs.subsDrawPolygon(evt.geometry);

                // get length and area measure
                this._activeGraphic = evt.geometry;
                (<any>this)._areaParams.polygons = [evt.geometry];
                this._geometryService.areasAndLengths((<any>this)._areaParams)

                this.addGraphic(evt.geometry, new this._bundle.SimpleFillSymbol());
                break;
            case 'extent':
                // trigger observable
                (<any>window).drawObs.subsDrawExtent(evt.geometry);

                this.deleteGraphics(evt.geometry);
                break;
        }
    }

    /**
     * Add graphic to graphiclayer
     * @function addGraphic
     * @param {Any} geometry esri geometry
     * @param {Any} symbol esri symbol
     */
    addGraphic(geometry: any, symbol: any) {
        // set color, graphic key, create the graphic, assign the key and add to layer
        symbol.color = this.activeColor;
        this.graphicKey = Math.random().toString(36).substr(2, 9);
        const graphic = new this._bundle.Graphic(geometry, symbol);
        graphic.key = this.graphicKey;
        this.graphicsLayer.add(graphic);

        // reset number of points for the geometry (use for wcag drawing)
        // reset mapPoints  array to remove theoric line length calculation
        this.geometryLength = 0;
        this.mapPoints = [];
    }

    /**
     * Delete graphic from graphiclayer
     * @function deleteGraphics
     * @param {Any} geometry esri geometry to use to delete graphic inside
     */
    deleteGraphics(geometry: any) {
        // create a polygon from the extent
        const poly = new this._bundle.Polygon({
            'rings': [[[geometry.xmin, geometry.ymin], [geometry.xmin, geometry.ymax], [geometry.xmax, geometry.ymax], [geometry.xmax, geometry.ymin], [geometry.xmin, geometry.ymin]]],
            'spatialReference': this._mapApi.fgpMapObj.spatialReference
        });

        this.geometryLength = 0;
        this.densifyGeom(poly);
    }

    /**
     * Get the distance live when user move his mouse
     * @function outputDistance
     * @param {Any} evt esri geometry service distance-complete event
     */
    outputDistance(evt: any) {
        // remove temp graphic
        // use this kind of loop because graphics array is dynamic
        const graphics = this.graphicsLayer.graphics;
        for (let i = 0; i < graphics.length; i++) {
            const graphic = graphics[i];
            if (graphic.key === 'tmp') {
                this.graphicsLayer.remove(graphic);
                i--;
            }
        }

        // add the new distance
        const graphic = new this._bundle.Graphic(this.mapPoints[1], new this._bundle.TextSymbol(`${evt.distance.toFixed(2)} km`));
        graphic.key = 'tmp';
        this.graphicsLayer.add(graphic);

        this.createBackground();
    }

    /**
     * Get the area and distance to add to graphic
     * @function outputAreaAndLength
     * @param {Any} evt esri geometry service areas-and-lengths-complete event
     * @param {Any} graphic esri graphic to apply value to
     */
    outputAreaAndLength(evt: any, graphic: any) {
        graphic.area = evt.result.areas[0].toFixed(2);
        graphic.length = evt.result.lengths[0].toFixed(2);
        (<any>this)._geometryService.labelPoints([graphic]);
    }

    /**
     * Get the length to add to graphic
     * @function outputLength
     * @param {Any} evt esri geometry service length-complete event
     * @param {Any} graphic esri graphic to apply value to
     */
    outputLength(evt: any, graphic: any) {
        const pt = graphic.paths[0][graphic.paths[0].length - 1];
        const point = new this._bundle.Point(pt[0], pt[1], this._mapApi.esriMap.spatialReference);
        const newGraphic = new this._bundle.Graphic(point, new this._bundle.TextSymbol(`${evt.result.lengths[0].toFixed(2)} km`));
        newGraphic.key = this.graphicKey;
        this.graphicsLayer.add(newGraphic);

        this.createBackground();
    }

    /**
     * Get the label to add to graphic
     * @function labelPoint
     * @param {Any} evt esri geometry service label-point-complete event
     * @param {Any} graphic esri graphic to apply value to
     */
    labelPoint(evt: any, graphic: any) {
        const newGraphic = new this._bundle.Graphic(evt.geometries[0], new this._bundle.TextSymbol(`${graphic.length} km\n${graphic.area} km\u00b2`));
        newGraphic.key = this.graphicKey;
        this.graphicsLayer.add(newGraphic);

        this.createBackground();
    }

    /**
     * Create measure svg backgrounbd
     * @function createBackground
     * @param {Boolean} [show] true to create and show label, false otherwise
     */
    createBackground(show?: boolean) {

        // delete background
        $('#graphicsRvColl_layer rect').remove();

        // check if we need to show or hide measure
        // measure are always creatd even when measure is false... they are just hidden
        this._showMeasure = (typeof show !== 'undefined') ? show : this._showMeasure;
        if (this._showMeasure) {
            $('#graphicsRvColl_layer text').removeClass('rv-draw-text-hide');
            $('#graphicsRvColl_layer rect').removeClass('rv-draw-text-hide');
        } else {
            $('#graphicsRvColl_layer text').addClass('rv-draw-text-hide');
            $('#graphicsRvColl_layer rect').addClass('rv-draw-text-hide');
        }

        // get text element and loop them to create background
        const graphics = $('#graphicsRvColl_layer text').not('.rv-draw-text-hide');
        for (let graphic of graphics.toArray()) {
            const lBox = (<any>graphic).getBBox();

            let rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', String(lBox.x - 2));
            rect.setAttribute('y', String(lBox.y + 1));
            rect.setAttribute('width', String(lBox.width + 4));
            rect.setAttribute('height', String(lBox.height - 2));
            rect.setAttribute('fill', 'rgba(255,255,255,0.9)');

            $(rect).insertBefore(graphic); 
        }
    }

    /**
     * Densify geometry
     * @function densifyGeom
     * @param {Any} geom geometry to densify
     */
    densifyGeom(geom) {
        let params = new this._bundle.DensifyParams();
        params.geodesic = true;
        params.geometries = [geom];
        params.lengthUnit = this._geometryService.UNIT_KILOMETER;

        this._geometryService.densify(params, geoms => {
            const graphics = this.graphicsLayer.graphics;

            const key: string[] = ['tmp'];
            for (let graphic of graphics) {
                if (geoms[0].getExtent().intersects(graphic.geometry)) {
                    key.push(graphic.key);
                }
            }

            // use this kind of loop because graphics array is dynamic
            for (let i = 0; i < graphics.length; i++) {
                const graphic = graphics[i];
                if (key.indexOf(graphic.key) !== -1) {
                    this.graphicsLayer.remove(graphic);
                    i--;
                }
            }

            this.createBackground();
        });
    };
}