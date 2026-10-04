"""Drive the actual QGIS georeferencer's file actions in an isolated profile."""
from qgis.PyQt.QtCore import QTimer
from qgis.PyQt.QtWidgets import QApplication, QAction, QFileDialog, QDialogButtonBox, QDialog, QLineEdit, QTextBrowser
from qgis.core import Qgis, QgsSettings, QgsProject, QgsCoordinateReferenceSystem
from qgis.utils import iface
import json, pathlib, base64
QgsProject.instance().setCrs(QgsCoordinateReferenceSystem('EPSG:3857'))
QgsSettings().setValue('/Projections/defaultBehavior','useProject')
input_text='#CRS: EPSG:3857\nmapX,mapY,sourceX,sourceY,enable,dX,dY,residual\n1000.123456789,2000.987654321,0.125,-0.5,1,0,0,0\n1200.125,2020.5,100.125,-0.5,1,0,0,0\n1030.25,1700.75,0.125,-100.5,1,0,0,0\n1230.125,1720.5,100.125,-100.5,0,0,0,0\n'
pathlib.Path('/tmp/input.points').write_text(input_text)
window=None

def choose(path):
    modal=QApplication.activeModalWidget()
    if isinstance(modal,QFileDialog):
        modal.setDirectory(str(pathlib.Path(path).parent))
        modal.selectFile(pathlib.Path(path).name)
        box=modal.findChild(QDialogButtonBox)
        button=box.button(QDialogButtonBox.Save if modal.acceptMode()==QFileDialog.AcceptSave else QDialogButtonBox.Open)
        print('CHOOSE',path,modal.selectedFiles(),button.isEnabled(),flush=True)
        def accept():
            modal.findChild(QLineEdit,'fileNameEdit').setText(path)
            print('ACCEPT',modal.selectedFiles(),button.isEnabled(),flush=True)
            button.click()
        QTimer.singleShot(500,accept)
    else:
        print('UNEXPECTED_MODAL', modal.objectName() if modal else None,flush=True)
        QTimer.singleShot(250,lambda:choose(path))
def action(name,path):
    a=window.findChild(QAction,name)
    assert a and a.isEnabled(),name
    QTimer.singleShot(300,lambda:choose(path))
    a.trigger()
def start():
    global window
    iface.mainWindow().findChild(QAction,'mActionShowGeoreferencer').trigger()
    window=next(w for w in QApplication.topLevelWidgets() if w.objectName()=='QgsGeorefPluginGuiBase')
    action('mActionOpenRaster','/fixtures/grid.png')
    QTimer.singleShot(500,load)
def load():
    action('mActionLoadGCPpoints','/tmp/input.points')
    QTimer.singleShot(500,save)
def save():
    action('mActionSaveGCPpoints','/tmp/qgis-written.points')
    QTimer.singleShot(500,finish)
def finish():
    data=pathlib.Path('/tmp/qgis-written.points').read_bytes()
    print('QGIS_POINTS='+json.dumps({'qgis':Qgis.QGIS_VERSION,'fixtureBase64':base64.b64encode(data).decode(),'input':input_text,'method':'QGIS desktop georeferencer Open Raster / Load GCP Points / Save GCP Points as actions'}),flush=True)
    QApplication.quit()
def timeout():
    print('MESSAGES',[w.toPlainText() for w in QApplication.allWidgets() if isinstance(w,QTextBrowser)],flush=True)
    print('TIMEOUT',[(w.objectName(),w.windowTitle()) for w in QApplication.topLevelWidgets() if w.isVisible()],flush=True);QApplication.quit()
QTimer.singleShot(45000,timeout)
QTimer.singleShot(1000,start)
