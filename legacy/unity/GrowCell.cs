using UnityEngine;
using System.Collections;

public class GrowCell : MonoBehaviour {

	int count=0;
	public GameObject cell;

	private int orientation;

	void Start (){
	}


	void Update ()
	{

		int chance = Random.Range (0, 4);
		//(Mathf.FloorToInt (40*Time.time*Time.time)));
		if (count < 10)
			switch (chance) {
			case 1:
				int CellType = Random.Range (0, 4);
				switch (CellType) {
				case 0:
					count++; 
					GameObject NewcellSpring = (GameObject)Instantiate (cell);
					NewcellSpring.transform.parent = this.transform;
					NewcellSpring.name = count.ToString ();
					orientation = Random.Range (0, 7);
					switch (orientation) {
					case 1:
						NewcellSpring.transform.position = new Vector3 (1, 0, 0);
						break;
					case 2:
						NewcellSpring.transform.position = new Vector3 (0, 1, 0);
						break;
					case 3:
						NewcellSpring.transform.position = new Vector3 (0, 0, 1);
						break;
					case 4:
						NewcellSpring.transform.position = new Vector3 (1, 0, 1);
						break;
					case 5:
						NewcellSpring.transform.position = new Vector3 (1, 1, 0);
						break;
					case 6:
						NewcellSpring.transform.position = new Vector3 (0, 1, 1);
						break;
					case 7:
						NewcellSpring.transform.position = new Vector3 (1, 1, 1);
						break;
					}

					foreach (Transform child in transform) {
						if ( (Vector3.Distance (child.position, NewcellSpring.transform.position) > 0.001)) {
							SpringJoint attachment = NewcellSpring.AddComponent<SpringJoint> ();
							attachment.connectedBody = child.GetComponent< Rigidbody> ();
							attachment.minDistance = 1;
							attachment.maxDistance = Vector3.Distance (child.position, NewcellSpring.transform.position);
						}
		
					}
					break;
				case 1:
					int size = Random.Range (0, 3);

					switch (size) {
					case 0:
						this.transform.localScale += new Vector3 (1f, 0, 0);
						break;
					case 1:
						this.transform.localScale += new Vector3 (0, 1f, 0);
						break;
					case 2:
						this.transform.localScale += new Vector3 (0, 0, 1f);
						break;
					}


					break;
				}

				break;
			}
		if (count >= 10) {
			foreach (Transform child in transform) {
				child.GetComponent<Rigidbody> ().useGravity = true;
				child.GetComponent<Rigidbody> ().drag = 1;
			}
			GameObject crea = GameObject.Find ("Creature(clone)");
			controller5 evalScript = this.GetComponent<controller5> ();
			evalScript.IsRunning = true;
		}
	}
}
	
